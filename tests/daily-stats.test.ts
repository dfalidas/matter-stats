import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyStat } from "../lib/daily-stat-builder";

test("daily rollups sum canonical per-session estimates and ignore stored and item estimates", () => {
  const result = buildDailyStat("2026-10-04", [
    { id: "a", item_id: "same", duration_seconds: 1, words_estimated: 999, matter_items: { id: "same", source: "Source", word_count: 1000, progress: 1, status: "archive" } },
    { id: "b", item_id: "same", duration_seconds: 1, words_estimated: null, matter_items: { id: "same", source: "Source", word_count: 1000, progress: 1, status: "archive" } },
    { id: "c", item_id: null, duration_seconds: 1, words_estimated: -8, matter_items: null },
    { id: "zero", item_id: null, duration_seconds: 0, words_estimated: 700, matter_items: null },
  ], 0);
  assert.equal(result.reading_time_seconds, 3);
  assert.equal(result.words_read, 12);
  assert.equal(result.sessions_count, 4);
});


test("daily provenance records explicit timezone and rejects invalid input instead of claiming canonical zero", () => {
  const result = buildDailyStat("2026-10-04", [], 0, "UTC");
  assert.deepEqual(result.reading_provenance, {wordMethod:"session-duration-225-round-v1",calendarMethod:"local-occurrence-day-v1",timezone:"UTC"});
  for (const duration_seconds of [null, -1, NaN, 0.5]) assert.throws(() => buildDailyStat("2026-10-04", [{id:"invalid",item_id:null,duration_seconds,words_estimated:null}], 0), /invalid session duration/);
});
