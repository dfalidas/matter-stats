import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, DailyStat, MatterItem, SyncRun } from "@/lib/supabase-types";
import { formatDateInTimezone, getDefaultMetricsTimezone } from "@/lib/metrics-service";

export type MatterStatsSupabaseClient = SupabaseClient<Database>;

export type DashboardSummary = {
  articlesRead: number;
  readingTimeSeconds: number;
  topSource: string | null;
  currentStreakDays: number;
};

export async function getDashboardSummary(client: MatterStatsSupabaseClient, now = new Date()): Promise<DashboardSummary> {
  const { data, error } = await client
    .from("daily_stats")
    .select("date, reading_time_seconds, items_read_count, top_source")
    .order("date", { ascending: false });

  if (error) {
    throw error;
  }

  const stats = data ?? [];
  const topSource = stats.find((stat) => stat.top_source)?.top_source ?? null;

  return {
    articlesRead: stats.reduce((total, stat) => total + stat.items_read_count, 0),
    readingTimeSeconds: stats.reduce((total, stat) => total + stat.reading_time_seconds, 0),
    topSource,
    currentStreakDays: countCurrentStreak(stats, now),
  };
}

export async function getReadingTrend(client: MatterStatsSupabaseClient, days = 30): Promise<DailyStat[]> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - Math.max(days - 1, 0));

  const { data, error } = await client
    .from("daily_stats")
    .select("*")
    .gte("date", since.toISOString().slice(0, 10))
    .order("date", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function getRecentMatterItems(client: MatterStatsSupabaseClient, limit = 10): Promise<MatterItem[]> {
  const { data, error } = await client
    .from("matter_items")
    .select("*")
    .order("updated_at_matter", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function getLatestSyncRun(client: MatterStatsSupabaseClient): Promise<SyncRun | null> {
  const { data, error } = await client.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

function countCurrentStreak(stats: Pick<DailyStat, "date" | "reading_time_seconds">[], now: Date): number {
  const activeDates = new Set(
    stats
      .filter((stat) => stat.reading_time_seconds > 0)
      .map((stat) => stat.date)
  );

  const timezone = getDefaultMetricsTimezone();
  let cursor = formatDateInTimezone(now, timezone);
  if (!activeDates.has(cursor)) {
    cursor = shiftCalendarDate(cursor, -1);
    if (!activeDates.has(cursor)) return 0;
  }

  let streak = 0;

  while (activeDates.has(cursor)) {
    streak += 1;
    cursor = shiftCalendarDate(cursor, -1);
  }

  return streak;
}

function shiftCalendarDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
