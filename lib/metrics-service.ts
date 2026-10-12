import { postgrestIn, readCompleteMetadata, readIdBatches } from "./complete-metadata-query";
import { readCompleteSessions } from "./complete-session-query";
import type { MatterStatsSupabaseClient } from "@/lib/supabase-queries";

import { estimateWordsFromSeconds, sumSessionWordEstimates } from "./reading-estimates";
import {
  addLocalDays,
  addCalendarDays,
  getAppTimezone,
  getLocalDateParts,
  getLocalDateTimeParts,
  localDateTimeToUtc,
  localDateToUtc,
  normalizeTimezone,
  timestampToCalendarDate,
} from "./calendar";

export { addLocalDays, localDateToUtc, timestampToCalendarDate as formatDateInTimezone } from "./calendar";
export { DEFAULT_APP_TIMEZONE } from "./calendar";

export const METRICS_PERIOD_PRESETS = ["today", "week", "month", "year", "all-time"] as const;

export type MetricsPeriodPreset = (typeof METRICS_PERIOD_PRESETS)[number];

export type MetricsDateRange = {
  start: Date | null;
  end: Date;
  startDate: string | null;
  endDate: string;
  timezone: string;
  preset: MetricsPeriodPreset | "custom";
};

export type MetricTotals = {
  totalReadingTimeSeconds: number;
  wordsRead: number;
  articlesRead: number;
  sessionsCount: number;
  averageSessionLengthSeconds: number;
};

export type RankedMetric = {
  name: string;
  readingTimeSeconds: number;
  wordsRead: number;
  articlesRead: number;
  sessionsCount: number;
};

export type RecentRead = {
  itemId: string | null;
  title: string | null;
  url: string | null;
  source: string | null;
  author: string | null;
  readAt: string | null;
  readingTimeSeconds: number;
  wordsRead: number;
};

export type ReadingHeatmapDay = {
  date: string;
  readingTimeSeconds: number;
  wordsRead: number;
  articlesRead: number;
  sessionsCount: number;
};

export type MetricsComparisonDelta = MetricTotals & {
  totalReadingTimePercentChange: number | null;
  wordsReadPercentChange: number | null;
  articlesReadPercentChange: number | null;
  sessionsCountPercentChange: number | null;
  averageSessionLengthPercentChange: number | null;
};

export type MetricsComparison = {
  range: MetricsDateRange | null;
  totals: MetricTotals;
  delta: MetricsComparisonDelta;
};

export type ReadingMetrics = {
  range: MetricsDateRange;
  totals: MetricTotals;
  currentStreakDays: number;
  historicalStreak: {
    asOfDate: string;
    days: number;
  } | null;
  bestStreakDays: number;
  topSources: RankedMetric[];
  topAuthors: RankedMetric[];
  topTags: RankedMetric[];
  recentReads: RecentRead[];
  heatmap: ReadingHeatmapDay[];
  comparison: MetricsComparison;
};

export type GetReadingMetricsOptions = {
  preset?: MetricsPeriodPreset;
  range?: {
    start?: Date | string | null;
    end?: Date | string;
  };
  /** Explicit comparison window. Null disables comparison (for example all-time). */
  comparisonRange?: { start: Date; end: Date } | null;
  timezone?: string;
  now?: Date | string;
  /** Optional local calendar date for a historical, explicitly as-of streak. */
  historicalStreakDate?: string;
  topLimit?: number;
  recentLimit?: number;
};

type SessionItem = {
  id: string;
  title: string | null;
  url: string | null;
  source: string | null;
  author: string | null;
};

type MetricsSession = {
  id: string;
  item_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  words_estimated: number | null;
  matter_items: SessionItem | SessionItem[] | null;
};

type TagJoinRow = {
  tag_id: string;
  item_id: string | null;
  matter_tags: { id: string; name: string } | { id: string; name: string }[] | null;
};

type MetricsAccumulator = {
  readingTimeSeconds: number;
  wordsRead: number;
  itemIds: Set<string>;
  sessionIds: Set<string>;
};

export function getDefaultMetricsTimezone(): string {
  return getAppTimezone();
}

export function resolveMetricsDateRange(options: GetReadingMetricsOptions = {}): MetricsDateRange {
  const timezone = normalizeTimezone(options.timezone);
  const now = normalizeDateInput(options.now ?? new Date());

  if (options.range) {
    const start = options.range.start === null ? null : options.range.start ? normalizeDateInput(options.range.start) : null;
    const end = options.range.end ? normalizeDateInput(options.range.end) : startOfNextLocalDay(now, timezone);

    return {
      start,
      end,
      startDate: start ? timestampToCalendarDate(start, timezone) : null,
      endDate: timestampToCalendarDate(end, timezone),
      timezone,
      preset: "custom",
    };
  }

  const preset = options.preset ?? "week";
  const today = getLocalDateParts(now, timezone);
  let start: Date | null;
  let end: Date;

  switch (preset) {
    case "today": {
      start = localDateToUtc(today.year, today.month, today.day, timezone);
      end = addLocalDays(start, 1, timezone);
      break;
    }
    case "week": {
      const weekday = getLocalWeekday(today.year, today.month, today.day);
      const daysSinceMonday = (weekday + 6) % 7;
      start = localDateToUtc(today.year, today.month, today.day - daysSinceMonday, timezone);
      end = addLocalDays(start, 7, timezone);
      break;
    }
    case "month": {
      start = localDateToUtc(today.year, today.month, 1, timezone);
      end = localDateToUtc(today.year, today.month + 1, 1, timezone);
      break;
    }
    case "year": {
      start = localDateToUtc(today.year, 1, 1, timezone);
      end = localDateToUtc(today.year + 1, 1, 1, timezone);
      break;
    }
    case "all-time": {
      start = null;
      end = startOfNextLocalDay(now, timezone);
      break;
    }
    default: {
      const exhaustive: never = preset;
      throw new Error(`Unsupported metrics preset: ${exhaustive}`);
    }
  }

  return {
    start,
    end,
    startDate: start ? timestampToCalendarDate(start, timezone) : null,
    endDate: timestampToCalendarDate(end, timezone),
    timezone,
    preset,
  };
}

export function getPreviousEquivalentRange(range: MetricsDateRange): MetricsDateRange | null {
  if (!range.start || range.preset === "all-time") {
    return null;
  }

  if (range.preset === "month") {
    const { year, month } = getLocalDateParts(range.start, range.timezone);
    const previousStart = localDateToUtc(year, month - 1, 1, range.timezone);

    return {
      start: previousStart,
      end: range.start,
      startDate: timestampToCalendarDate(previousStart, range.timezone),
      endDate: timestampToCalendarDate(range.start, range.timezone),
      timezone: range.timezone,
      preset: "custom",
    };
  }

  if (range.preset === "year") {
    const { year } = getLocalDateParts(range.start, range.timezone);
    const previousStart = localDateToUtc(year - 1, 1, 1, range.timezone);

    return {
      start: previousStart,
      end: range.start,
      startDate: timestampToCalendarDate(previousStart, range.timezone),
      endDate: timestampToCalendarDate(range.start, range.timezone),
      timezone: range.timezone,
      preset: "custom",
    };
  }

  const days = Math.max(1, differenceInLocalDays(range.start, range.end, range.timezone));
  const previousStart = addLocalDays(range.start, -days, range.timezone);

  return {
    start: previousStart,
    end: range.start,
    startDate: timestampToCalendarDate(previousStart, range.timezone),
    endDate: timestampToCalendarDate(range.start, range.timezone),
    timezone: range.timezone,
    preset: "custom",
  };
}

export async function getReadingMetrics(
  client: MatterStatsSupabaseClient,
  options: GetReadingMetricsOptions = {}
): Promise<ReadingMetrics> {
  const now = normalizeDateInput(options.now ?? new Date());
  const range = resolveMetricsDateRange({ ...options, now });
  const previousRange = options.comparisonRange === null
    ? null
    : options.comparisonRange
      ? metricsRange(options.comparisonRange.start, options.comparisonRange.end, range.timezone)
      : getPreviousEquivalentRange(range);
  const topLimit = Math.max(1, options.topLimit ?? 10);
  const recentLimit = Math.max(1, options.recentLimit ?? 10);

  const currentStreakEnd = startOfNextLocalDay(now, range.timezone);
  const historicalStreakDate = options.historicalStreakDate
    ? normalizeLocalDate(options.historicalStreakDate)
    : null;
  const historicalStreakEnd = historicalStreakDate
    ? addLocalDays(localDateFromString(historicalStreakDate, range.timezone), 1, range.timezone)
    : null;

  const [rangeSessions, previousSessions, bestStreakSessions, currentStreakSessions, historicalStreakSessions] = await Promise.all([
    fetchSessionsForRange(client, range),
    previousRange ? fetchSessionsForRange(client, previousRange) : Promise.resolve([]),
    fetchSessionsForStreaks(client, range.end),
    fetchSessionsForStreaks(client, currentStreakEnd),
    historicalStreakEnd ? fetchSessionsForStreaks(client, historicalStreakEnd) : Promise.resolve([]),
  ]);

  const rangeItemIds = uniqueStrings(rangeSessions.map((session) => session.item_id).filter(isNonEmptyString));
  const rangeTagsByItemId = await fetchTagsByItemId(client, rangeItemIds);

  const totals = summarizeSessions(rangeSessions);
  const previousTotals = summarizeSessions(previousSessions);

  return {
    range,
    totals,
    currentStreakDays: calculateStreakAsOf(currentStreakSessions, timestampToCalendarDate(now, range.timezone), range.timezone, true),
    historicalStreak: historicalStreakDate
      ? { asOfDate: historicalStreakDate, days: calculateStreakAsOf(historicalStreakSessions, historicalStreakDate, range.timezone, true) }
      : null,
    bestStreakDays: calculateBestStreak(bestStreakSessions, range.timezone),
    topSources: rankBySessionItem(rangeSessions, (item) => item?.source, topLimit),
    topAuthors: rankBySessionItem(rangeSessions, (item) => item?.author, topLimit),
    topTags: rankTags(rangeSessions, rangeTagsByItemId, topLimit),
    recentReads: buildRecentReads(rangeSessions, recentLimit),
    heatmap: buildHeatmap(rangeSessions, range, range.timezone),
    comparison: {
      range: previousRange,
      totals: previousTotals,
      delta: buildComparisonDelta(totals, previousTotals),
    },
  };
}

function normalizeLocalDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid historical streak date: ${value}`);
  const [year, month, day] = value.split("-").map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1 || normalized.getUTCDate() !== day) {
    throw new Error(`Invalid historical streak date: ${value}`);
  }
  return value;
}

function localDateFromString(value: string, timezone: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return localDateToUtc(year, month, day, timezone);
}

function normalizeDateInput(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid metrics date: ${String(value)}`);
  return date;
}

function startOfNextLocalDay(date: Date, timezone: string): Date {
  return addLocalDays(localDateToUtc(
    getLocalDateParts(date, timezone).year,
    getLocalDateParts(date, timezone).month,
    getLocalDateParts(date, timezone).day,
    timezone,
  ), 1, timezone);
}

function metricsRange(start: Date, end: Date, timezone: string): MetricsDateRange {
  return { start, end, startDate: timestampToCalendarDate(start, timezone), endDate: timestampToCalendarDate(end, timezone), timezone, preset: "custom" };
}

/** Period-to-date bounds and the same local calendar position in the preceding period. */
export function resolvePeriodToDateRanges(preset: Exclude<MetricsPeriodPreset, "all-time">, now: Date, timezone = getAppTimezone()) {
  const full = resolveMetricsDateRange({ preset, now, timezone });
  const current = { start: full.start!, end: new Date(now) };
  const parts = getLocalDateTimeParts(now, timezone);
  let target = { ...parts };
  if (preset === "today") target = shiftedDay(parts, -1);
  else if (preset === "week") target = shiftedDay(parts, -7);
  else if (preset === "month") target = clampedShift(parts, 0, -1);
  else target = clampedShift(parts, -1, 0);
  const previousEnd = localDateTimeToUtc(target, timezone);
  const previousFull = resolveMetricsDateRange({ preset, now: previousEnd, timezone });
  return { range: current, comparisonRange: { start: previousFull.start!, end: previousEnd } };
}

function shiftedDay(parts: ReturnType<typeof getLocalDateTimeParts>, days: number) {
  const [year, month, day] = addCalendarDays(
    `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    days,
  ).split("-").map(Number);
  return { ...parts, year, month, day };
}

function clampedShift(parts: ReturnType<typeof getLocalDateTimeParts>, years: number, months: number) {
  const monthIndex = parts.month - 1 + months;
  const year = parts.year + years + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { ...parts, year, month, day: Math.min(parts.day, lastDay) };
}

function getLocalWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function differenceInLocalDays(start: Date, end: Date, timezone: string): number {
  const startLocal = getLocalDateParts(start, timezone);
  const endLocal = getLocalDateParts(end, timezone);
  const startUtc = Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day);
  const endUtc = Date.UTC(endLocal.year, endLocal.month - 1, endLocal.day);
  return Math.round((endUtc - startUtc) / 86_400_000);
}

async function fetchSessionsForRange(client: MatterStatsSupabaseClient, range: MetricsDateRange): Promise<MetricsSession[]> {
  return fetchAllSessions(client, range.start, range.end);
}

async function fetchSessionsForStreaks(client: MatterStatsSupabaseClient, end: Date): Promise<MetricsSession[]> {
  return fetchAllSessions(client, null, end);
}

async function fetchAllSessions(
  client: MatterStatsSupabaseClient,
  start: Date | null,
  end: Date,
): Promise<MetricsSession[]> {
  return readCompleteSessions<MetricsSession>(() => {
    let query = client.from("reading_sessions")
      .select("id,item_id,started_at,ended_at,duration_seconds,words_estimated,matter_items(id,title,url,source,author)")
      .lt("started_at", end.toISOString());
    if (start) query = query.gte("started_at", start.toISOString());
    return query;
  });
}

async function fetchTagsByItemId(client: MatterStatsSupabaseClient, itemIds: string[]): Promise<Map<string, string[]>> {
  if (itemIds.length === 0) {
    return new Map();
  }

  const data = await readIdBatches<TagJoinRow>(itemIds, (ids) => readCompleteMetadata<TagJoinRow>(() => client.from("item_tags")
    .select("item_id,tag_id,matter_tags(id,name)").filter("item_id", "in", postgrestIn(ids))
    .order("item_id", { ascending: true }).order("tag_id", { ascending: true }), ["item_id", "tag_id"]), ["item_id", "tag_id"]);

  const tagsByItemId = new Map<string, string[]>();

  for (const row of (data ?? []) as unknown as TagJoinRow[]) {
    const tagRows = Array.isArray(row.matter_tags) ? row.matter_tags : row.matter_tags ? [row.matter_tags] : [];
    const names = tagRows.map((tag) => tag.name?.trim()).filter(isNonEmptyString);
    if (!isNonEmptyString(row.item_id)) {
      continue;
    }
    tagsByItemId.set(row.item_id, [...(tagsByItemId.get(row.item_id) ?? []), ...names]);
  }

  return tagsByItemId;
}

function summarizeSessions(sessions: MetricsSession[]): MetricTotals {
  const totalReadingTimeSeconds = sessions.reduce((total, session) => total + positiveInteger(session.duration_seconds), 0);
  const wordsRead = sumSessionWordEstimates(sessions);
  const articlesRead = new Set(sessions.map((session) => session.item_id).filter(isNonEmptyString)).size;
  const sessionsCount = sessions.length;

  return {
    totalReadingTimeSeconds,
    wordsRead,
    articlesRead,
    sessionsCount,
    averageSessionLengthSeconds: sessionsCount > 0 ? Math.round(totalReadingTimeSeconds / sessionsCount) : 0,
  };
}

function rankBySessionItem(
  sessions: MetricsSession[],
  getName: (item: SessionItem | null) => string | null | undefined,
  limit: number
): RankedMetric[] {
  const buckets = new Map<string, MetricsAccumulator>();

  for (const session of sessions) {
    const item = getSessionItem(session);
    const name = getName(item)?.trim();

    if (!name) {
      continue;
    }

    addToBucket(buckets, name, session);
  }

  return rankBuckets(buckets, limit);
}

function rankTags(sessions: MetricsSession[], tagsByItemId: Map<string, string[]>, limit: number): RankedMetric[] {
  const buckets = new Map<string, MetricsAccumulator>();

  for (const session of sessions) {
    if (!isNonEmptyString(session.item_id)) {
      continue;
    }
    const tags = tagsByItemId.get(session.item_id) ?? [];

    for (const tag of tags) {
      addToBucket(buckets, tag, session);
    }
  }

  return rankBuckets(buckets, limit);
}

function addToBucket(buckets: Map<string, MetricsAccumulator>, name: string, session: MetricsSession) {
  const existing = buckets.get(name) ?? {
    readingTimeSeconds: 0,
    wordsRead: 0,
    itemIds: new Set<string>(),
    sessionIds: new Set<string>(),
  };

  existing.readingTimeSeconds += positiveInteger(session.duration_seconds);
  existing.wordsRead += estimateWordsFromSeconds(positiveInteger(session.duration_seconds));
  if (isNonEmptyString(session.item_id)) {
    existing.itemIds.add(session.item_id);
  }
  existing.sessionIds.add(session.id);
  buckets.set(name, existing);
}

function rankBuckets(buckets: Map<string, MetricsAccumulator>, limit: number): RankedMetric[] {
  return [...buckets.entries()]
    .map(([name, value]) => ({
      name,
      readingTimeSeconds: value.readingTimeSeconds,
      wordsRead: value.wordsRead,
      articlesRead: value.itemIds.size,
      sessionsCount: value.sessionIds.size,
    }))
    .sort(
      (a, b) =>
        b.readingTimeSeconds - a.readingTimeSeconds || b.wordsRead - a.wordsRead || b.articlesRead - a.articlesRead || a.name.localeCompare(b.name)
    )
    .slice(0, limit);
}

function buildRecentReads(sessions: MetricsSession[], limit: number): RecentRead[] {
  const readsByItemId = new Map<string, RecentRead>();

  for (const session of sessions) {
    const bucketId = session.item_id ?? `unknown:${session.id}`;
    const existing = readsByItemId.get(bucketId);
    const item = getSessionItem(session);
    const readAt = session.started_at;

    if (existing) {
      existing.readingTimeSeconds += positiveInteger(session.duration_seconds);
      existing.wordsRead += estimateWordsFromSeconds(positiveInteger(session.duration_seconds));
      if (readAt && (!existing.readAt || readAt > existing.readAt)) {
        existing.readAt = readAt;
      }
      continue;
    }

    readsByItemId.set(bucketId, {
      itemId: session.item_id,
      title: item?.title ?? "Unknown item",
      url: item?.url ?? null,
      source: item?.source ?? null,
      author: item?.author ?? null,
      readAt,
      readingTimeSeconds: positiveInteger(session.duration_seconds),
      wordsRead: estimateWordsFromSeconds(positiveInteger(session.duration_seconds)),
    });
  }

  return [...readsByItemId.values()]
    .sort((a, b) => (b.readAt ?? "").localeCompare(a.readAt ?? ""))
    .slice(0, limit);
}

function buildHeatmap(sessions: MetricsSession[], range: MetricsDateRange, timezone: string): ReadingHeatmapDay[] {
  const byDate = new Map<string, MetricsAccumulator>();

  for (const session of sessions) {
    if (!session.started_at) {
      continue;
    }

    const date = timestampToCalendarDate(new Date(session.started_at), timezone);
    addToBucket(byDate, date, session);
  }

  if (!range.start) {
    return rankHeatmapDates(byDate);
  }

  const days = Math.max(0, differenceInLocalDays(range.start, range.end, timezone) + (isLocalMidnight(range.end, timezone) ? 0 : 1));
  const heatmap: ReadingHeatmapDay[] = [];

  for (let index = 0; index < days; index += 1) {
    const date = timestampToCalendarDate(addLocalDays(range.start, index, timezone), timezone);
    const accumulator = byDate.get(date);
    heatmap.push({
      date,
      readingTimeSeconds: accumulator?.readingTimeSeconds ?? 0,
      wordsRead: accumulator?.wordsRead ?? 0,
      articlesRead: accumulator?.itemIds.size ?? 0,
      sessionsCount: accumulator?.sessionIds.size ?? 0,
    });
  }

  return heatmap;
}

function isLocalMidnight(date: Date, timezone: string): boolean {
  const p = getLocalDateTimeParts(date, timezone);
  return p.hour === 0 && p.minute === 0 && p.second === 0 && p.millisecond === 0;
}

function rankHeatmapDates(byDate: Map<string, MetricsAccumulator>): ReadingHeatmapDay[] {
  return [...byDate.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, accumulator]) => ({
      date,
      readingTimeSeconds: accumulator.readingTimeSeconds,
      wordsRead: accumulator.wordsRead,
      articlesRead: accumulator.itemIds.size,
      sessionsCount: accumulator.sessionIds.size,
    }));
}

function calculateStreakAsOf(
  sessions: MetricsSession[],
  asOfDate: string,
  timezone: string,
  allowYesterdayFallback: boolean,
): number {
  const activeDates = getActiveDates(sessions, timezone);
  let cursor = localDateFromString(asOfDate, timezone);
  if (!activeDates.has(asOfDate)) {
    if (!allowYesterdayFallback) return 0;
    cursor = addLocalDays(cursor, -1, timezone);
    if (!activeDates.has(timestampToCalendarDate(cursor, timezone))) return 0;
  }
  let streak = 0;

  while (activeDates.has(timestampToCalendarDate(cursor, timezone))) {
    streak += 1;
    cursor = addLocalDays(cursor, -1, timezone);
  }

  return streak;
}

function calculateBestStreak(sessions: MetricsSession[], timezone: string): number {
  const activeDates = [...getActiveDates(sessions, timezone)].sort();
  let best = 0;
  let current = 0;
  let previous: string | null = null;

  for (const date of activeDates) {
    if (previous && differenceBetweenDateStrings(previous, date) === 1) {
      current += 1;
    } else {
      current = 1;
    }

    best = Math.max(best, current);
    previous = date;
  }

  return best;
}

function getActiveDates(sessions: MetricsSession[], timezone: string): Set<string> {
  return new Set(
    sessions
      .filter((session) => positiveInteger(session.duration_seconds) > 0)
      .map((session) => (session.started_at ? timestampToCalendarDate(new Date(session.started_at), timezone) : null))
      .filter(isNonEmptyString)
  );
}

function differenceBetweenDateStrings(first: string, second: string): number {
  const [firstYear, firstMonth, firstDay] = first.split("-").map(Number);
  const [secondYear, secondMonth, secondDay] = second.split("-").map(Number);
  return Math.round((Date.UTC(secondYear, secondMonth - 1, secondDay) - Date.UTC(firstYear, firstMonth - 1, firstDay)) / 86_400_000);
}

function buildComparisonDelta(current: MetricTotals, previous: MetricTotals): MetricsComparisonDelta {
  return {
    totalReadingTimeSeconds: current.totalReadingTimeSeconds - previous.totalReadingTimeSeconds,
    wordsRead: current.wordsRead - previous.wordsRead,
    articlesRead: current.articlesRead - previous.articlesRead,
    sessionsCount: current.sessionsCount - previous.sessionsCount,
    averageSessionLengthSeconds: current.averageSessionLengthSeconds - previous.averageSessionLengthSeconds,
    totalReadingTimePercentChange: percentChange(current.totalReadingTimeSeconds, previous.totalReadingTimeSeconds),
    wordsReadPercentChange: percentChange(current.wordsRead, previous.wordsRead),
    articlesReadPercentChange: percentChange(current.articlesRead, previous.articlesRead),
    sessionsCountPercentChange: percentChange(current.sessionsCount, previous.sessionsCount),
    averageSessionLengthPercentChange: percentChange(current.averageSessionLengthSeconds, previous.averageSessionLengthSeconds),
  };
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }

  return (current - previous) / previous;
}

function getSessionItem(session: MetricsSession): SessionItem | null {
  if (Array.isArray(session.matter_items)) {
    return session.matter_items[0] ?? null;
  }

  return session.matter_items;
}

function positiveInteger(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(isNonEmptyString))];
}
