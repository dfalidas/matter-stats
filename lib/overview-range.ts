import { addCalendarDays, formatCalendarDate, getLocalDateTimeParts } from "./calendar";
import type { ReadingMetrics } from "./metrics-service";

export function formatOverviewRangeLabel(metrics: Pick<ReadingMetrics, "range">): string {
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
