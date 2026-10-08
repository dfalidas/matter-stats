import assert from "node:assert/strict";
import test from "node:test";

import { normalizeReadingSession } from "../lib/matter-normalizers.js";
import { getMatterSyncInitialPhase, getMatterSyncSessionsLimit, getRecentActivityWindowStart } from "../lib/matter-sync-progress.js";
import { getDefaultMetricsTimezone, getReadingMetrics } from "../lib/metrics-service.js";
import { calendarDayBounds, calendarYear, timestampToCalendarDate } from "../lib/calendar.js";
import { resolveReportRange } from "../lib/reports-service.js";

/** Target TODOs stay until their complete multi-page/lease/query requirements land. */
test("R3 characterization: recent defaults remain 25 rows and a fixed initial year bound", () => {
  const limits = getMatterSyncSessionsLimit({});
  assert.equal(limits, 25);
  assert.equal(getRecentActivityWindowStart(new Date("2026-09-29T00:00:00Z"), "current_year"), "2026-01-01T00:00:00.000Z");
});
// R3 is active in matter-sync-entrypoint.test.mjs after real fresh/upgrade
// 5,000-session acceptance; see docs/task-14-validation.md.

test("R4 characterization: public trigger modes still map to their endpoint streams", () => {
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

function streakClient(dates: string[]) {
  const sessions = dates.map((started_at, index) => ({
    id: `streak-${index}`, item_id: null, started_at, ended_at: null,
    duration_seconds: 60, words_estimated: 225, matter_items: null,
  }));
  return { from(table: string) {
    const rows = table === "reading_sessions" ? sessions : [];
    let window: [number, number] | null = null;
    const query = {
      select: () => query, lt: () => query, gte: () => query, order: () => query,
      range: (from: number, to: number) => { window = [from, to]; return query; },
      in: () => Promise.resolve({ data: [], error: null }),
      then: (resolve: (value: { data: typeof rows; error: null }) => unknown) => {
        const data = window ? rows.slice(window[0], window[1] + 1) : rows;
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return query;
  } } as never;
}

test("R6 target (W5): sessions on 26–28 September yield current streak 3 as of 28 September regardless of preset", async () => {
  const client = streakClient(["2026-09-26T10:00:00Z", "2026-09-27T10:00:00Z", "2026-09-28T10:00:00Z"]);
  for (const preset of ["today", "week", "month", "year", "all-time"] as const) {
    const metrics = await getReadingMetrics(client, { preset, now: "2026-09-28T18:00:00Z", timezone: "UTC" });
    assert.equal(metrics.currentStreakDays, 3, preset);
  }
});
test("R6 target (W5): yesterday's streak survives an empty today, while empty today and yesterday yields zero", async () => {
  const client = streakClient(["2026-09-26T10:00:00Z", "2026-09-27T10:00:00Z", "2026-09-28T10:00:00Z"]);
  const on29 = await getReadingMetrics(client, { preset: "today", now: "2026-09-29T18:00:00Z", timezone: "UTC" });
  const on30 = await getReadingMetrics(client, { preset: "today", now: "2026-09-30T18:00:00Z", timezone: "UTC" });
  assert.equal(on29.currentStreakDays, 3);
  assert.equal(on30.currentStreakDays, 0);
});

test("R7 target (W5): three 60-second sessions estimate 675 words at 225 WPM, not 3,000 item words", () => {
  const estimates = ["s-1", "s-2", "s-3"].map((id) =>
    normalizeReadingSession({ id, date: "2026-09-29T10:00:00Z", seconds_read: 60 }, { item: { word_count: 1_000, progress: 1 } })?.words_estimated,
  );
  assert.deepEqual(estimates, [225, 225, 225]);
  assert.equal(estimates.reduce((total, words) => total + (words ?? 0), 0), 675);
});

test("R8: the default timezone is Europe/Athens", () => {
  const previous = process.env.APP_TIMEZONE;
  delete process.env.APP_TIMEZONE;
  assert.equal(getDefaultMetricsTimezone(), "Europe/Athens");
  if (previous === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = previous;
});
test("R8 target (W5): Athens midnight, DST, year ranges, and explicit UTC use local half-open boundaries", () => {
  assert.equal(timestampToCalendarDate("2026-09-27T20:59:59Z", "Europe/Athens"), "2026-09-27");
  assert.equal(timestampToCalendarDate("2026-09-27T21:00:00Z", "Europe/Athens"), "2026-09-28");

  const spring = calendarDayBounds("2026-03-29", "Europe/Athens");
  assert.deepEqual([spring.start.toISOString(), spring.end.toISOString()], ["2026-03-28T22:00:00.000Z", "2026-03-29T21:00:00.000Z"]);
  assert.equal(spring.end.getTime() - spring.start.getTime(), 23 * 60 * 60 * 1000);
  const autumn = calendarDayBounds("2026-10-25", "Europe/Athens");
  assert.deepEqual([autumn.start.toISOString(), autumn.end.toISOString()], ["2026-10-24T21:00:00.000Z", "2026-10-25T22:00:00.000Z"]);
  assert.equal(autumn.end.getTime() - autumn.start.getTime(), 25 * 60 * 60 * 1000);

  const year = resolveReportRange("yearly", "2026", new Date("2026-06-01T00:00:00Z"));
  assert.deepEqual([year.start.toISOString(), year.end.toISOString()], ["2025-12-31T22:00:00.000Z", "2026-12-31T22:00:00.000Z"]);
  const utc = calendarDayBounds("2026-10-25", "UTC");
  assert.deepEqual([utc.start.toISOString(), utc.end.toISOString()], ["2026-10-25T00:00:00.000Z", "2026-10-26T00:00:00.000Z"]);
});

test("R8 target (W5): configured local year changes at Athens midnight independently of UTC", () => {
  assert.equal(calendarYear(timestampToCalendarDate("2026-12-31T22:30:00Z", "Europe/Athens")), 2027);
  assert.equal(calendarYear(timestampToCalendarDate("2026-12-31T22:30:00Z", "UTC")), 2026);
});
