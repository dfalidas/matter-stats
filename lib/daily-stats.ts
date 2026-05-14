import { getSupabaseAdminClient, upsertDailyStats } from "@/lib/supabase-admin";
import type { TablesInsert } from "@/lib/supabase-types";

const RECALCULATION_BATCH_SIZE = 100;
const DEFAULT_READING_SPEED_WORDS_PER_MINUTE = 225;
const READ_ITEM_STATUSES = new Set(["archive", "read", "completed"]);

export type DailyStatsRecalculation = {
  affectedDates: Set<string>;
};

type DailyStatsSession = {
  id?: string | null;
  item_id: string | null;
  duration_seconds: number | null;
  words_estimated: number | null;
  matter_items?: DailyStatsItem | DailyStatsItem[] | null;
};

type DailyStatsItem = {
  id: string;
  source: string | null;
  word_count: number | null;
  progress: number | null;
  status: string | null;
};

export async function recalculateDailyStats({ affectedDates }: DailyStatsRecalculation) {
  const dates = [...affectedDates].filter(isValidDateString).sort();
  if (dates.length === 0) {
    return;
  }

  const stats: TablesInsert<"daily_stats">[] = [];
  for (const date of dates) {
    stats.push(await calculateDailyStat(date));
  }

  await upsertInBatches(stats, upsertDailyStats);
}

export async function recalculateDailyStatsForDateRange(startDate: string, endDate: string) {
  const dates = getDateRange(startDate, endDate);
  await recalculateDailyStats({ affectedDates: new Set(dates) });
}

export async function calculateDailyStat(date: string): Promise<TablesInsert<"daily_stats">> {
  if (!isValidDateString(date)) {
    throw new Error(`Invalid daily stats date: ${date}`);
  }

  const client = getSupabaseAdminClient();
  const { start, end } = getUtcDayBounds(date);

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

export function buildDailyStat(
  date: string,
  sessions: DailyStatsSession[],
  highlightsCount: number
): TablesInsert<"daily_stats"> {
  const sessionIds = new Set<string>();
  const itemIds = new Set<string>();
  const readItemIds = new Set<string>();
  const sourceSeconds = new Map<string, number>();
  const sourceSessions = new Map<string, number>();
  const fallbackWordsByItemId = new Map<string, number>();
  const itemIdsWithSessionWords = new Set<string>();
  let readingTimeSeconds = 0;
  let wordsRead = 0;

  for (const session of sessions) {
    if (session.id) {
      sessionIds.add(session.id);
    }

    const item = getSessionItem(session);
    const itemId = session.item_id ?? item?.id ?? null;
    if (itemId) {
      itemIds.add(itemId);
    }
    if (itemId && isReadItem(item)) {
      readItemIds.add(itemId);
    }

    const durationSeconds = positiveInteger(session.duration_seconds);
    readingTimeSeconds += durationSeconds;

    const sessionWords = positiveInteger(session.words_estimated);
    if (sessionWords > 0) {
      wordsRead += sessionWords;
      if (itemId) {
        itemIdsWithSessionWords.add(itemId);
        fallbackWordsByItemId.delete(itemId);
      }
    } else if (itemId) {
      const itemWords = estimateItemWords(item);
      if (itemWords > 0) {
        if (!itemIdsWithSessionWords.has(itemId)) {
          fallbackWordsByItemId.set(itemId, Math.max(fallbackWordsByItemId.get(itemId) ?? 0, itemWords));
        }
      } else {
        wordsRead += estimateWordsFromDuration(durationSeconds);
      }
    } else {
      wordsRead += estimateWordsFromDuration(durationSeconds);
    }

    const source = item?.source?.trim();
    if (source) {
      sourceSeconds.set(source, (sourceSeconds.get(source) ?? 0) + durationSeconds);
      sourceSessions.set(source, (sourceSessions.get(source) ?? 0) + 1);
    }
  }

  wordsRead += [...fallbackWordsByItemId.values()].reduce((total, words) => total + words, 0);

  return {
    date,
    reading_time_seconds: readingTimeSeconds,
    words_read: wordsRead,
    sessions_count: sessionIds.size > 0 ? sessionIds.size : sessions.length,
    items_read_count: readItemIds.size > 0 ? readItemIds.size : itemIds.size,
    highlights_count: positiveInteger(highlightsCount),
    top_source: getTopSource(sourceSeconds, sourceSessions),
  };
}

function estimateItemWords(item: DailyStatsItem | null): number {
  const wordCount = positiveInteger(item?.word_count ?? null);
  const progress = positiveProgress(item?.progress ?? null);
  return wordCount > 0 && progress !== null ? Math.round(wordCount * progress) : 0;
}

function estimateWordsFromDuration(durationSeconds: number): number {
  return durationSeconds > 0 ? Math.round((durationSeconds / 60) * DEFAULT_READING_SPEED_WORDS_PER_MINUTE) : 0;
}

function isReadItem(item: DailyStatsItem | null): boolean {
  if (!item) {
    return false;
  }

  const status = item.status?.trim().toLowerCase();
  return (status ? READ_ITEM_STATUSES.has(status) : false) || positiveProgress(item.progress) === 1;
}

function getSessionItem(session: DailyStatsSession): DailyStatsItem | null {
  if (Array.isArray(session.matter_items)) {
    return session.matter_items[0] ?? null;
  }

  return session.matter_items ?? null;
}

function getTopSource(sourceSeconds: Map<string, number>, sourceSessions: Map<string, number>): string | null {
  let topSource: string | null = null;
  let topSeconds = -1;
  let topSessions = -1;

  for (const [source, seconds] of sourceSeconds) {
    const sessions = sourceSessions.get(source) ?? 0;
    if (
      seconds > topSeconds ||
      (seconds === topSeconds && sessions > topSessions) ||
      (seconds === topSeconds && sessions === topSessions && (topSource === null || source.localeCompare(topSource) < 0))
    ) {
      topSource = source;
      topSeconds = seconds;
      topSessions = sessions;
    }
  }

  return topSource;
}

async function upsertInBatches<Row>(rows: Row[], upsert: (batch: Row[]) => Promise<unknown>) {
  for (let index = 0; index < rows.length; index += RECALCULATION_BATCH_SIZE) {
    await upsert(rows.slice(index, index + RECALCULATION_BATCH_SIZE));
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
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function getUtcDayBounds(date: string) {
  const startDate = new Date(`${date}T00:00:00.000Z`);
  const endDate = new Date(startDate.getTime());
  endDate.setUTCDate(endDate.getUTCDate() + 1);

  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

function positiveInteger(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function positiveProgress(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(Math.max(value, 0), 1);
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
