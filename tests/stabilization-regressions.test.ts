import assert from "node:assert/strict";
import test from "node:test";

import { normalizeReadingSession } from "../lib/matter-normalizers.js";
import { getMatterSyncInitialPhase, getMatterSyncSessionsLimit, getRecentActivityWindowStart } from "../lib/matter-sync-progress.js";
import { getDefaultMetricsTimezone } from "../lib/metrics-service.js";

/** W0 characterization tests remain green; adjacent TODOs are W4/W5 gates. */
test("R3 characterization: current sync is one bounded page and defaults to the current year", () => {
  const limits = getMatterSyncSessionsLimit({});
  assert.equal(limits, 25);
  assert.equal(getRecentActivityWindowStart(new Date("2026-09-29T00:00:00Z"), "current_year"), "2026-01-01T00:00:00.000Z");
});
test.todo("R3 target (W4): a 5,000-session stream resumes across pages/invocations without an annual reset");

test("R4 characterization: trigger modes still select phases in shared sync state", () => {
  assert.equal(getMatterSyncInitialPhase("recent_activity_manual"), "sessions");
  assert.equal(getMatterSyncInitialPhase("recent_activity_scheduled"), "sessions");
  assert.equal(getMatterSyncInitialPhase("backfill_library"), "items");
});
test.todo("R4 target (W4): manual→scheduled→manual preserves independent cursor and a fenced lease admits one writer");

const largeDataset = Array.from({ length: 1_200 }, (_, index) => ({ id: `session-${index}`, seconds: 60 }));
test("R5 synthetic fixture independently defines the complete expected total", () => {
  assert.equal(new Set(largeDataset.map(({ id }) => id)).size, 1_200);
  assert.equal(largeDataset.reduce((sum, row) => sum + row.seconds, 0), 72_000);
});
test.todo("R5 target (W5): dashboard totals retrieve all 1,200 rows when the mocked Data API caps pages at 1,000");

test.todo("R6 target (W5): sessions on 26–28 September yield current streak 3 as of 28 September regardless of preset");
test.todo("R6 target (W5): yesterday's streak survives an empty today, while empty today and yesterday yields zero");

test("R7 characterization: item word_count×progress is currently copied to every session", () => {
  const normalized = normalizeReadingSession({ id: "s-1", date: "2026-09-29T10:00:00Z", seconds_read: 60 }, { item: { word_count: 1_000, progress: 1 } });
  assert.equal(normalized?.words_estimated, 1_000);
});
test.todo("R7 target (W5): three 60-second sessions estimate 675 words at 225 WPM, not 3,000 item words");

test("R8: the default timezone is Europe/Athens", () => {
  const previous = process.env.APP_TIMEZONE;
  delete process.env.APP_TIMEZONE;
  assert.equal(getDefaultMetricsTimezone(), "Europe/Athens");
  if (previous === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = previous;
});
test.todo("R8 target (W5): Athens midnight, Monday boundary, DST and year boundary bucket identically in every metric/rollup");
