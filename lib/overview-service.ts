import { createAnalyticsQueryContext } from "./analytics-query-context";
import { addCalendarDays, formatCalendarDate, getLocalDateTimeParts } from "./calendar";
import {
  getReadingMetrics,
  localDateToUtc,
  resolvePeriodToDateRanges,
  type MetricsPeriodPreset,
  type ReadingMetrics,
} from "./metrics-service";
import type { MatterStatsSupabaseClient } from "./supabase-queries";

/** Production Overview metrics path. Its caller captures and supplies `now` once. */
export async function getOverviewReadingMetrics(
  client: MatterStatsSupabaseClient,
  period: MetricsPeriodPreset,
  start: string | null,
  end: string | null,
  now: Date,
  timezone: string,
) {
  const customRange = start && end ? {
    start: localDateToUtc(...dateParts(start), timezone),
    end: localDateToUtc(...nextDateParts(end), timezone),
  } : null;
  const selectedOptions = customRange
    ? { range: customRange }
    : period === "all-time"
      ? { preset: period, comparisonRange: null }
      : resolvePeriodToDateRanges(period, now, timezone);
  const todayOptions = resolvePeriodToDateRanges("today", now, timezone);

  const common = { now, timezone, topLimit: 5, recentLimit: 6, queryContext: createAnalyticsQueryContext(client) };
  // All-time is already a required input and contains today/selected history.
  // Register it first so concurrent compatible reads share its promise.
  const allTimeRead = getReadingMetrics(client, { preset: "all-time", comparisonRange: null, ...common });
  const [metrics, todayMetrics, allTimeMetrics] = await Promise.all([
    getReadingMetrics(client, { ...selectedOptions, ...common }),
    getReadingMetrics(client, { ...todayOptions, ...common }),
    allTimeRead,
  ]);
  return { metrics, todayMetrics, allTimeMetrics };
}

export function formatOverviewRangeLabel(metrics: ReadingMetrics): string {
  const { range } = metrics;
  const suffix = ` · ${range.timezone}`;
  if (range.start && range.end.getTime() <= range.start.getTime()) {
    return `As of ${formatCalendarDate(range.endDate, { day: "numeric", month: "short", year: "numeric" })}${suffix}`;
  }
  const endParts = getLocalDateTimeParts(range.end, range.timezone);
  const endDate = isMidnight(endParts) ? addCalendarDays(range.endDate, -1) : range.endDate;
  return `${range.startDate ? formatCalendarDate(range.startDate, { day: "numeric", month: "short" }) : "All time"} – ${formatCalendarDate(endDate, { day: "numeric", month: "short", year: "numeric" })}${suffix}`;
}

function isMidnight(parts: ReturnType<typeof getLocalDateTimeParts>) {
  return parts.hour === 0 && parts.minute === 0 && parts.second === 0 && parts.millisecond === 0;
}

function dateParts(value: string): [number, number, number] {
  return value.split("-").map(Number) as [number, number, number];
}

function nextDateParts(value: string): [number, number, number] {
  const [year, month, day] = addCalendarDays(value, 1).split("-").map(Number);
  return [year, month, day];
}

/** Only selected metrics are displayed by Overview. Keep complete internal
 * today/all-time results for service consumers, outside client props. */
export function toOverviewClientPayload(result: Awaited<ReturnType<typeof getOverviewReadingMetrics>>) {
  return { metrics: result.metrics };
}
