import type { ReadingHeatmapDay } from "./metrics-service";

export function formatReportCsv(days: ReadingHeatmapDay[]): string {
  const rows: Array<Array<string | number>> = [
    ["date", "reading_time_seconds", "estimated_words", "sessions"],
    ...days.map((day) => [day.date, day.readingTimeSeconds, day.wordsRead, day.sessionsCount]),
  ];
  return rows.map((row) => row.join(",")).join("\n");
}
