import {
  addLocalDays,
  formatDateInTimezone,
  getDefaultMetricsTimezone,
  getReadingMetrics,
  localDateToUtc,
  type MetricsPeriodPreset,
  type ReadingMetrics,
} from "./metrics-service";
import type { MatterStatsSupabaseClient } from "./supabase-queries";
import { estimateWordsFromSeconds } from "./reading-estimates";

type ReportSessionItem = {
  id: string;
  title: string | null;
  url: string | null;
  source: string | null;
  author: string | null;
  estimated_reading_time_minutes: number | null;
  word_count: number | null;
};

type ReportSessionRow = {
  id: string;
  item_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  words_estimated: number | null;
  matter_items: ReportSessionItem | ReportSessionItem[] | null;
};

export type ReportPeriod = "daily" | "weekly" | "monthly" | "yearly";

export const REPORT_PERIODS = ["daily", "weekly", "monthly", "yearly"] as const;

export const REPORT_PERIOD_TO_METRICS_PRESET: Record<ReportPeriod, MetricsPeriodPreset> = {
  daily: "today",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

export type ReadingSessionTimelineItem = {
  id: string;
  itemId: string | null;
  title: string | null;
  url: string | null;
  source: string | null;
  author: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  wordsRead: number;
};

export type LongformRead = {
  itemId: string | null;
  title: string | null;
  url: string | null;
  source: string | null;
  author: string | null;
  readingTimeSeconds: number;
  wordsRead: number;
  sessionsCount: number;
  estimatedReadingTimeMinutes: number | null;
};

export type ReadingReport = {
  period: ReportPeriod;
  metrics: ReadingMetrics;
  timeline: ReadingSessionTimelineItem[];
  longformReads: LongformRead[];
  latestWeekWithDataStartDate: string | null;
};

export async function getReadingReport(
  client: MatterStatsSupabaseClient,
  period: ReportPeriod,
  options?: { weekStartDate?: string | null }
): Promise<ReadingReport> {
  const weeklyRange = period === "weekly" ? await resolveWeeklyRange(client, options?.weekStartDate) : null;
  const metrics = await getReadingMetrics(client, {
    ...(weeklyRange
      ? {
          range: {
            start: weeklyRange.start,
            end: weeklyRange.end,
          },
        }
      : { preset: REPORT_PERIOD_TO_METRICS_PRESET[period] }),
    topLimit: 6,
    recentLimit: 8,
  });
  const sessions = await fetchReportSessions(client, metrics);

  return {
    period,
    metrics,
    timeline: sessions.map(mapTimelineSession),
    longformReads: buildLongformReads(sessions, 6),
    latestWeekWithDataStartDate: weeklyRange?.latestWeekWithDataStartDate ?? null,
  };
}

async function resolveWeeklyRange(client: MatterStatsSupabaseClient, requestedWeekStartDate?: string | null) {
  const timezone = getDefaultMetricsTimezone();
  const reference = requestedWeekStartDate && isRealDate(requestedWeekStartDate)
    ? requestedWeekStartDate
    : formatDateInTimezone(new Date(), timezone);
  const [year, month, day] = reference.split("-").map(Number);
  const localWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const start = localDateToUtc(year, month, day - ((localWeekday + 6) % 7), timezone);
  const end = addLocalDays(start, 7, timezone);
  return {
    start,
    end,
    latestWeekWithDataStartDate: await getLatestWeekWithDataStartDate(client),
  };
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function getLatestWeekWithDataStartDate(client: MatterStatsSupabaseClient): Promise<string | null> {
  const { data, error } = await client
    .from("daily_stats")
    .select("date")
    .gt("reading_time_seconds", 0)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data?.date) {
    return formatWeekStart(getWeekStart(new Date(`${data.date}T00:00:00.000Z`)));
  }

  const { data: session, error: sessionError } = await client
    .from("reading_sessions")
    .select("started_at")
    .gt("duration_seconds", 0)
    .not("started_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session?.started_at) return null;
  return formatWeekStart(getWeekStart(new Date(session.started_at)));
}

function getWeekStart(date: Date): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = result.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  result.setUTCDate(result.getUTCDate() - daysSinceMonday);
  return result;
}

function formatWeekStart(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchReportSessions(
  client: MatterStatsSupabaseClient,
  metrics: ReadingMetrics,
): Promise<ReportSessionRow[]> {
  const rows: ReportSessionRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    let query = client
      .from("reading_sessions")
      .select("id,item_id,started_at,ended_at,duration_seconds,words_estimated,matter_items(id,title,url,source,author,estimated_reading_time_minutes,word_count)")
      .lt("started_at", metrics.range.end.toISOString())
      .order("started_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (metrics.range.start) query = query.gte("started_at", metrics.range.start.toISOString());
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as unknown as ReportSessionRow[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function buildLongformReads(sessions: ReportSessionRow[], limit: number): LongformRead[] {
  const reads = new Map<string, LongformRead>();

  for (const session of sessions) {
    const readKey = session.item_id ?? `session:${session.id}`;
    const item = getReportSessionItem(session);
    const existing = reads.get(readKey);

    if (existing) {
      existing.readingTimeSeconds += positiveInteger(session.duration_seconds);
      existing.wordsRead = estimateWordsFromSeconds(existing.readingTimeSeconds);
      existing.sessionsCount += 1;
      continue;
    }

    reads.set(readKey, {
      itemId: session.item_id,
      title: item?.title ?? null,
      url: item?.url ?? null,
      source: item?.source ?? null,
      author: item?.author ?? null,
      readingTimeSeconds: positiveInteger(session.duration_seconds),
      wordsRead: estimateWordsFromSeconds(positiveInteger(session.duration_seconds)),
      sessionsCount: 1,
      estimatedReadingTimeMinutes: item?.estimated_reading_time_minutes ?? null,
    });
  }

  return [...reads.values()]
    .sort(
      (a, b) =>
        b.wordsRead - a.wordsRead ||
        b.readingTimeSeconds - a.readingTimeSeconds ||
        b.sessionsCount - a.sessionsCount ||
        (a.title ?? "").localeCompare(b.title ?? ""),
    )
    .slice(0, limit);
}

function mapTimelineSession(session: ReportSessionRow): ReadingSessionTimelineItem {
  const item = getReportSessionItem(session);

  return {
    id: session.id,
    itemId: session.item_id,
    title: item?.title ?? null,
    url: item?.url ?? null,
    source: item?.source ?? null,
    author: item?.author ?? null,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    durationSeconds: positiveInteger(session.duration_seconds),
    wordsRead: estimateWordsFromSeconds(positiveInteger(session.duration_seconds)),
  };
}

function getReportSessionItem(session: ReportSessionRow): ReportSessionItem | null {
  if (Array.isArray(session.matter_items)) {
    return session.matter_items[0] ?? null;
  }

  return session.matter_items;
}

function positiveInteger(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}
