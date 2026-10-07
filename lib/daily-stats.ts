import { renewMatterSyncLease } from "./matter-sync-lease";
import { leaseRpcArgs, type MatterSyncLease } from "./matter-sync-lease-context";
import { getSupabaseAdminClient, upsertDailyStats, getPendingDailyStats, acknowledgeDailyStat } from "./supabase-admin";
import type { TablesInsert } from "./supabase-types";
import { buildDailyStat, type DailyStatsSession } from "./daily-stat-builder";
import { addCalendarDays, calendarDayBounds, getAppTimezone, isCalendarDate } from "./calendar";
export { buildDailyStat } from "./daily-stat-builder";

const RECALCULATION_BATCH_SIZE = 100;
export type DailyStatsRecalculation = {
  affectedDates: Set<string>;
};

export async function recalculateDailyStats({ affectedDates }: DailyStatsRecalculation, lease: MatterSyncLease) {
  leaseRpcArgs(lease);
  const dates = [...affectedDates].filter(isValidDateString).sort();
  if (dates.length === 0) {
    return;
  }

  const stats: TablesInsert<"daily_stats">[] = [];
  for (const date of dates) {
    await renewMatterSyncLease(lease);
    stats.push(await calculateDailyStat(date));
  }

  await upsertInBatches(stats, upsertDailyStats, lease);
}

export async function recalculateDailyStatsForDateRange(startDate: string, endDate: string, lease: MatterSyncLease) {
  const dates = getDateRange(startDate, endDate);
  await recalculateDailyStats({ affectedDates: new Set(dates) }, lease);
}

export async function calculateDailyStat(date: string, timezone: string = getAppTimezone()): Promise<TablesInsert<"daily_stats">> {
  if (!isValidDateString(date)) {
    throw new Error(`Invalid daily stats date: ${date}`);
  }

  const client = getSupabaseAdminClient();
  const bounds = calendarDayBounds(date, timezone);
  const start = bounds.start.toISOString();
  const end = bounds.end.toISOString();

  const [{ data: sessions, error: sessionsError }, { count: highlightsCount, error: annotationsError }] = await Promise.all([
    client
      .from("reading_sessions")
      .select("id,item_id,duration_seconds,words_estimated,matter_items(id,source,word_count,progress,status)")
      .gte("started_at", start)
      .lt("started_at", end),
    client
      .from("annotations")
      .select("id", { count: "exact", head: true })
      .gte("created_at_matter", start)
      .lt("created_at_matter", end),
  ]);

  if (sessionsError) {
    throw sessionsError;
  }
  if (annotationsError) {
    throw annotationsError;
  }

  return buildDailyStat(date, (sessions ?? []) as unknown as DailyStatsSession[], highlightsCount ?? 0);
}

async function upsertInBatches<Row>(rows: Row[], upsert: (batch: Row[], lease: MatterSyncLease) => Promise<unknown>, lease: MatterSyncLease) {
  for (let index = 0; index < rows.length; index += RECALCULATION_BATCH_SIZE) {
    await renewMatterSyncLease(lease);
    await upsert(rows.slice(index, index + RECALCULATION_BATCH_SIZE), lease);
  }
}

function getDateRange(startDate: string, endDate: string): string[] {
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    throw new Error(`Invalid daily stats date range: ${startDate} through ${endDate}`);
  }
  if (endDate < startDate) {
    throw new Error(`Daily stats end date must be on or after start date: ${startDate} through ${endDate}`);
  }

  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }

  return dates;
}

function isValidDateString(value: string): boolean {
  return isCalendarDate(value);
}

// One bounded snapshot per call. Newer work survives exact-revision acknowledgement.
export const PENDING_ROLLUP_WORK_LIMIT = 32;
export async function processPendingDailyStats(lease: MatterSyncLease): Promise<number> {
  leaseRpcArgs(lease);
  const pending = await getPendingDailyStats(PENDING_ROLLUP_WORK_LIMIT, lease);
  let acknowledged = 0;
  for (const marker of pending) {
    await renewMatterSyncLease(lease);
    const row = await calculateDailyStat(marker.date, marker.timezone);
    if (await acknowledgeDailyStat(marker, row, lease)) acknowledged++;
  }
  return acknowledged;
}
