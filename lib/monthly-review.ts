import { timestampToCalendarDate } from "./calendar";
import type { StreakSession } from "./analytics-query-context";

export type ReviewCoverage = "incomplete" | "unknown" | "unavailable";
export type MonthState = "closed" | "current" | "future";
export type MonthSummary = {
  seconds: number;
  sessions: number;
  activeDays: number;
  timePerActiveDay: number | null;
  averageSession: number | null;
};

export function monthState(
  month: string,
  now: Date,
  timezone: string,
): MonthState {
  const current = timestampToCalendarDate(now, timezone).slice(0, 7);
  return month < current ? "closed" : month === current ? "current" : "future";
}

/** Preserve raw-reader normalization, including NULL/invalid-to-zero behavior.
 * Report anomalies separately; never rewrite stored input. */
export function summarizeMonth(
  rows: StreakSession[],
  timezone: string,
): MonthSummary {
  const days = new Map<string, number>();
  let seconds = 0;
  for (const row of rows) {
    const duration = canonicalSeconds(row.duration_seconds);
    seconds += duration;
    if (row.started_at) {
      const date = timestampToCalendarDate(row.started_at, timezone);
      days.set(date, (days.get(date) ?? 0) + duration);
    }
  }
  const activeDays = [...days.values()].filter((value) => value > 0).length;
  return {
    seconds,
    sessions: rows.length,
    activeDays,
    timePerActiveDay: activeDays ? seconds / activeDays : null,
    averageSession: rows.length ? seconds / rows.length : null,
  };
}
export function canonicalSeconds(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}
export function reviewAnomalies(rows: StreakSession[], now: Date) {
  return {
    invalidDurations: rows.filter(
      (row) =>
        row.duration_seconds !== null &&
        (!Number.isFinite(row.duration_seconds) ||
          row.duration_seconds! < 0 ||
          !Number.isInteger(row.duration_seconds)),
    ).length,
    nullDurations: rows.filter((row) => row.duration_seconds === null).length,
    futureOccurrences: rows.filter(
      (row) => row.started_at && Date.parse(row.started_at) > now.getTime(),
    ).length,
  };
}
export function formatReviewTime(seconds: number): string {
  if (seconds > 0 && seconds < 30) return "<1 min";
  const minutes = Math.round(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
    : `${minutes} min`;
}
const percent = (value: number) => Number(value.toFixed(1)).toString();
const averageMinutes = (value: number) => `${(value / 60).toFixed(1)} min`;

/** Ordered, deterministic imported-data observations. No claims for partial/future inputs. */
export function monthlyObservations(
  state: MonthState,
  coverage: ReviewCoverage,
  current: MonthSummary | null,
  previous: MonthSummary | null,
): string[] {
  if (state !== "closed" || coverage !== "unknown" || !current || !previous)
    return [];
  const delta = current.seconds - previous.seconds;
  const time =
    delta === 0
      ? `Imported reading time unchanged${previous.seconds === 0 ? ": No change (0 in both)" : ""}.`
      : `Imported reading time ${delta > 0 ? "increased" : "decreased"} by ${formatReviewTime(Math.abs(delta))}${previous.seconds > 0 ? ` (${percent((100 * Math.abs(delta)) / previous.seconds)}%)` : "; Up from 0"}.`;
  let rhythm: string;
  if (
    current.activeDays > previous.activeDays &&
    current.sessions > 0 &&
    previous.sessions > 0 &&
    current.averageSession! < previous.averageSession!
  ) {
    rhythm = `More active days (${current.activeDays} vs ${previous.activeDays}), shorter average sessions (${averageMinutes(current.averageSession!)} vs ${averageMinutes(previous.averageSession!)}).`;
  } else if (current.activeDays > 0 && previous.activeDays > 0) {
    rhythm = `Time per active day: ${formatReviewTime(current.timePerActiveDay!)} vs ${formatReviewTime(previous.timePerActiveDay!)}; active days: ${current.activeDays} vs ${previous.activeDays}.`;
  } else {
    const difference = current.activeDays - previous.activeDays;
    rhythm = `Active days: ${current.activeDays} vs ${previous.activeDays} (${difference > 0 ? "+" : ""}${difference}; ${difference === 0 ? "no change" : difference > 0 ? "increase" : "decrease"}).`;
  }
  return [time, `Imported sessions: ${rhythm}`];
}
