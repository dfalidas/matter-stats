import assert from "node:assert/strict";
import test from "node:test";
import { formatReportCsv } from "../lib/report-csv";

test("CSV exports canonical aggregated words rather than re-estimating day duration", () => {
  const csv = formatReportCsv([{ date: "2026-10-04", readingTimeSeconds: 3, wordsRead: 12, articlesRead: 1, sessionsCount: 3 }]);
  assert.equal(csv, "date,reading_time_seconds,estimated_words,sessions\n2026-10-04,3,12,3");
});
