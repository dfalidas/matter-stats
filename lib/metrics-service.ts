import type { MatterStatsSupabaseClient } from "@/lib/supabase-queries";

export const DEFAULT_APP_TIMEZONE = "Europe/London";

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
  itemId: string;
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
  timezone?: string;
  now?: Date | string;
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
  item_id: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  words_estimated: number | null;
  matter_items: SessionItem | SessionItem[] | null;
};

type TagJoinRow = {
  item_id: string;
  matter_tags: { id: string; name: string } | { id: string; name: string }[] | null;
};

type MetricsAccumulator = {
  readingTimeSeconds: number;
  wordsRead: number;
  itemIds: Set<string>;
  sessionIds: Set<string>;
};

export function getDefaultMetricsTimezone(): string {
  const configuredTimezone = process.env.APP_TIMEZONE?.trim();
  return configuredTimezone && isValidTimezone(configuredTimezone) ? configuredTimezone : DEFAULT_APP_TIMEZONE;
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
      startDate: start ? formatDateInTimezone(start, timezone) : null,
      endDate: formatDateInTimezone(end, timezone),
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
    startDate: start ? formatDateInTimezone(start, timezone) : null,
    endDate: formatDateInTimezone(end, timezone),
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
      startDate: formatDateInTimezone(previousStart, range.timezone),
      endDate: formatDateInTimezone(range.start, range.timezone),
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
      startDate: formatDateInTimezone(previousStart, range.timezone),
      endDate: formatDateInTimezone(range.start, range.timezone),
      timezone: range.timezone,
      preset: "custom",
    };
  }

  const days = Math.max(1, differenceInLocalDays(range.start, range.end, range.timezone));
  const previousStart = addLocalDays(range.start, -days, range.timezone);

  return {
    start: previousStart,
    end: range.start,
    startDate: formatDateInTimezone(previousStart, range.timezone),
    endDate: formatDateInTimezone(range.start, range.timezone),
    timezone: range.timezone,
    preset: "custom",
  };
}

export async function getReadingMetrics(
  client: MatterStatsSupabaseClient,
  options: GetReadingMetricsOptions = {}
): Promise<ReadingMetrics> {
  const range = resolveMetricsDateRange(options);
  const previousRange = getPreviousEquivalentRange(range);
  const topLimit = Math.max(1, options.topLimit ?? 10);
  const recentLimit = Math.max(1, options.recentLimit ?? 10);

  const [rangeSessions, previousSessions, streakSessions] = await Promise.all([
    fetchSessionsForRange(client, range),
    previousRange ? fetchSessionsForRange(client, previousRange) : Promise.resolve([]),
    fetchSessionsForStreaks(client, range.end),
  ]);

  const rangeItemIds = uniqueStrings(rangeSessions.map((session) => session.item_id));
  const rangeTagsByItemId = await fetchTagsByItemId(client, rangeItemIds);

  const totals = summarizeSessions(rangeSessions);
  const previousTotals = summarizeSessions(previousSessions);

  return {
    range,
    totals,
    currentStreakDays: calculateCurrentStreak(streakSessions, range.end, range.timezone),
    bestStreakDays: calculateBestStreak(streakSessions, range.timezone),
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

function normalizeTimezone(timezone?: string): string {
  const value = timezone?.trim() || getDefaultMetricsTimezone();
  return isValidTimezone(value) ? value : DEFAULT_APP_TIMEZONE;
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeDateInput(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid metrics date: ${String(value)}`);
  }

  return date;
}

function getDateTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const lookup = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.get("year")),
    month: Number(lookup.get("month")),
    day: Number(lookup.get("day")),
    hour: Number(lookup.get("hour")),
    minute: Number(lookup.get("minute")),
    second: Number(lookup.get("second")),
  };
}

function getLocalDateParts(date: Date, timezone: string) {
  const { year, month, day } = getDateTimeParts(date, timezone);
  return { year, month, day };
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = getDateTimeParts(date, timezone);
  const utcFromLocalParts = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return utcFromLocalParts - date.getTime();
}

function localDateToUtc(year: number, month: number, day: number, timezone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const firstPass = new Date(utcGuess.getTime() - getTimezoneOffsetMs(utcGuess, timezone));
  return new Date(utcGuess.getTime() - getTimezoneOffsetMs(firstPass, timezone));
}

function formatDateInTimezone(date: Date, timezone: string): string {
  const { year, month, day } = getLocalDateParts(date, timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addLocalDays(date: Date, days: number, timezone: string): Date {
  const local = getLocalDateParts(date, timezone);
  return localDateToUtc(local.year, local.month, local.day + days, timezone);
}

function startOfNextLocalDay(date: Date, timezone: string): Date {
  const local = getLocalDateParts(date, timezone);
  return localDateToUtc(local.year, local.month, local.day + 1, timezone);
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
  let query = client
    .from("reading_sessions")
    .select("id,item_id,started_at,ended_at,duration_seconds,words_estimated,matter_items(id,title,url,source,author)")
    .lt("started_at", range.end.toISOString())
    .order("started_at", { ascending: false, nullsFirst: false });

  if (range.start) {
    query = query.gte("started_at", range.start.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as MetricsSession[];
}

async function fetchSessionsForStreaks(client: MatterStatsSupabaseClient, end: Date): Promise<MetricsSession[]> {
  const { data, error } = await client
    .from("reading_sessions")
    .select("id,item_id,started_at,ended_at,duration_seconds,words_estimated")
    .lt("started_at", end.toISOString())
    .order("started_at", { ascending: true, nullsFirst: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as MetricsSession[];
}

async function fetchTagsByItemId(client: MatterStatsSupabaseClient, itemIds: string[]): Promise<Map<string, string[]>> {
  if (itemIds.length === 0) {
    return new Map();
  }

  const { data, error } = await client.from("item_tags").select("item_id,matter_tags(id,name)").in("item_id", itemIds);

  if (error) {
    throw error;
  }

  const tagsByItemId = new Map<string, string[]>();

  for (const row of (data ?? []) as unknown as TagJoinRow[]) {
    const tagRows = Array.isArray(row.matter_tags) ? row.matter_tags : row.matter_tags ? [row.matter_tags] : [];
    const names = tagRows.map((tag) => tag.name?.trim()).filter(isNonEmptyString);
    tagsByItemId.set(row.item_id, [...(tagsByItemId.get(row.item_id) ?? []), ...names]);
  }

  return tagsByItemId;
}

function summarizeSessions(sessions: MetricsSession[]): MetricTotals {
  const totalReadingTimeSeconds = sessions.reduce((total, session) => total + positiveInteger(session.duration_seconds), 0);
  const wordsRead = sessions.reduce((total, session) => total + positiveInteger(session.words_estimated), 0);
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
  existing.wordsRead += positiveInteger(session.words_estimated);
  existing.itemIds.add(session.item_id);
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
    const existing = readsByItemId.get(session.item_id);
    const item = getSessionItem(session);
    const readAt = session.started_at;

    if (existing) {
      existing.readingTimeSeconds += positiveInteger(session.duration_seconds);
      existing.wordsRead += positiveInteger(session.words_estimated);
      if (readAt && (!existing.readAt || readAt > existing.readAt)) {
        existing.readAt = readAt;
      }
      continue;
    }

    readsByItemId.set(session.item_id, {
      itemId: session.item_id,
      title: item?.title ?? null,
      url: item?.url ?? null,
      source: item?.source ?? null,
      author: item?.author ?? null,
      readAt,
      readingTimeSeconds: positiveInteger(session.duration_seconds),
      wordsRead: positiveInteger(session.words_estimated),
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

    const date = formatDateInTimezone(new Date(session.started_at), timezone);
    addToBucket(byDate, date, session);
  }

  if (!range.start) {
    return rankHeatmapDates(byDate);
  }

  const days = differenceInLocalDays(range.start, range.end, timezone);
  const heatmap: ReadingHeatmapDay[] = [];

  for (let index = 0; index < days; index += 1) {
    const date = formatDateInTimezone(addLocalDays(range.start, index, timezone), timezone);
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

function calculateCurrentStreak(sessions: MetricsSession[], end: Date, timezone: string): number {
  const activeDates = getActiveDates(sessions, timezone);
  let cursor = addLocalDays(end, -1, timezone);
  let streak = 0;

  while (activeDates.has(formatDateInTimezone(cursor, timezone))) {
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
      .filter((session) => positiveInteger(session.duration_seconds) > 0 || positiveInteger(session.words_estimated) > 0)
      .map((session) => (session.started_at ? formatDateInTimezone(new Date(session.started_at), timezone) : null))
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
