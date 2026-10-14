import { createAnalyticsQueryContext } from "./analytics-query-context";
import { addCalendarDays } from "./calendar";
export { formatOverviewRangeLabel } from "./overview-range";
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
  const { range, totals, comparison, heatmap } = result.metrics;
  return { metrics: { range, totals, comparison, heatmap } };
}

export type OverviewClientPayload = ReturnType<typeof toOverviewClientPayload>;
