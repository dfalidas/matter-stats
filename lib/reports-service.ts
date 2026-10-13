import { createAnalyticsQueryContext, type AnalyticsSession, type AnalyticsSessionItem } from "./analytics-query-context";
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
import { buildSessionLengthHistogram, estimateWordsFromSeconds } from "./reading-estimates";
import { addCalendarDays, timestampToCalendarDate } from "./calendar";

type ReportSessionItem = AnalyticsSessionItem;
type ReportSessionRow = AnalyticsSession;

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
  sessionLengthHistogram: ReturnType<typeof buildSessionLengthHistogram>;
  longformReads: LongformRead[];
  latestWeekWithDataStartDate: string | null;
};

export async function getReadingReport(
  client: MatterStatsSupabaseClient,
  period: ReportPeriod,
  options?: { reference?: string | null; weekStartDate?: string | null; now?: Date }
): Promise<ReadingReport> {
  const now = new Date(options?.now ?? new Date());
  const requestedReference = options?.reference ?? options?.weekStartDate;
  const timezone = getDefaultMetricsTimezone();
  const selectedRange = resolveReportRange(period, requestedReference, now, timezone);
  const latestWeekWithDataStartDate = period === "weekly" ? await getLatestWeekWithDataStartDate(client, timezone) : null;
  const queryContext = createAnalyticsQueryContext(client);
  const metrics = await getReadingMetrics(client, {
    queryContext,
    timezone,
    range: selectedRange,
    comparisonRange: resolvePreviousReportRange(period, selectedRange, timezone),
    now,
    historicalStreakDate: formatDateInTimezone(addLocalDays(selectedRange.end, -1, timezone), timezone),
    topLimit: 6,
    recentLimit: 8,
  });
  const sessions = await queryContext.sessions(metrics.range.start, metrics.range.end, "details");

  return {
    period,
    metrics,
    timeline: sessions.map(mapTimelineSession),
    sessionLengthHistogram: buildSessionLengthHistogram(sessions.map((session) => positiveInteger(session.duration_seconds))),
    longformReads: buildLongformReads(sessions, 6),
    latestWeekWithDataStartDate,
  };
}

function resolvePreviousReportRange(period: ReportPeriod, range: { start: Date; end: Date }, timezone: string) {
  if (period === "monthly") {
    const key = formatDateInTimezone(range.start, timezone);
    const [year, month] = key.split("-").map(Number);
    return { start: localDateToUtc(year, month - 1, 1, timezone), end: range.start };
  }
  if (period === "yearly") {
    const year = Number(formatDateInTimezone(range.start, timezone).slice(0, 4));
    return { start: localDateToUtc(year - 1, 1, 1, timezone), end: range.start };
  }
  const days = period === "weekly" ? 7 : 1;
  return { start: addLocalDays(range.start, -days, timezone), end: range.start };
}

export function resolveReportRange(period: ReportPeriod, requested?: string | null, now = new Date(), timezone = getDefaultMetricsTimezone()) {
  const today = formatDateInTimezone(now, timezone);
  const fallback = period === "yearly" ? today.slice(0, 4) : period === "monthly" ? today.slice(0, 7) : today;
  const reference = isValidReportReference(period, requested) ? requested : fallback;
  const [year, month = 1, day = 1] = reference.split("-").map(Number);
  let start: Date;
  let end: Date;

  if (period === "yearly") {
    start = localDateToUtc(year, 1, 1, timezone);
    end = localDateToUtc(year + 1, 1, 1, timezone);
  } else if (period === "monthly") {
    start = localDateToUtc(year, month, 1, timezone);
    end = localDateToUtc(year, month + 1, 1, timezone);
  } else if (period === "weekly") {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    start = localDateToUtc(year, month, day - ((weekday + 6) % 7), timezone);
    end = addLocalDays(start, 7, timezone);
  } else {
    start = localDateToUtc(year, month, day, timezone);
    end = addLocalDays(start, 1, timezone);
  }
  return { start, end };
}

export function isValidReportReference(period: ReportPeriod, value: string | null | undefined): value is string {
  if (!value) return false;
  if (period === "yearly") return /^\d{4}$/.test(value) && Number(value) >= 1;
  if (period === "monthly") {
    if (!/^\d{4}-\d{2}$/.test(value)) return false;
    const month = Number(value.slice(5));
    return month >= 1 && month <= 12;
  }
  return isRealDate(value);
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function getLatestWeekWithDataStartDate(client: MatterStatsSupabaseClient, timezone: string): Promise<string | null> {
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
  const localDate = timestampToCalendarDate(session.started_at, timezone);
  const [year, month, day] = localDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addCalendarDays(localDate, -((weekday + 6) % 7));
}

function buildLongformReads(sessions: ReportSessionRow[], limit: number): LongformRead[] {
  const reads = new Map<string, LongformRead>();

  for (const session of sessions) {
    const readKey = session.item_id ?? `session:${session.id}`;
    const item = getReportSessionItem(session);
    const existing = reads.get(readKey);

    if (existing) {
      existing.readingTimeSeconds += positiveInteger(session.duration_seconds);
      existing.wordsRead += estimateWordsFromSeconds(positiveInteger(session.duration_seconds));
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

/** Complete aggregates, fixed bins and no raw sessions cross the RSC boundary. */
export function toReportsClientPayload(report: ReadingReport) {
  const { range, totals, comparison, heatmap } = report.metrics;
  return { period: report.period, metrics: { range, totals, comparison, heatmap }, sessionLengthHistogram: report.sessionLengthHistogram };
}
export type ReportsClientPayload = ReturnType<typeof toReportsClientPayload>;

export function toYearInReadingClientPayload(report: ReadingReport) {
  return { metrics: report.metrics, longformReads: report.longformReads };
}
export type YearInReadingClientPayload = ReturnType<typeof toYearInReadingClientPayload>;
