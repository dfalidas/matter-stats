import { cappedPostgrest } from "./fixtures/capped-postgrest";
import { getArticleList } from "../lib/articles-service";
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
// R4 is active in matter-sync-entrypoint.test.mjs after real fresh/upgrade
// cross-trigger, contention and fencing acceptance; see docs/task-15-validation.md.

test("R5 session retrieval target (Task 16): 1,200 sessions / 72,000 seconds under cap 100", async () => {
  const sessions = Array.from({ length: 1_200 }, (_, index) => ({
    id: `session-${String(index).padStart(4, "0")}`, item_id: null,
    started_at: "2026-09-28T10:00:00Z", ended_at: null,
    duration_seconds: 60, words_estimated: null, matter_items: null,
  }));
  const { client } = cappedPostgrest({ reading_sessions: sessions }, { cap: 100 });
  const metrics = await getReadingMetrics(client, { preset: "all-time", now: "2026-09-28T12:00:00Z", timezone: "UTC" });
  assert.equal(metrics.totals.sessionsCount, 1_200);
  assert.equal(metrics.totals.totalReadingTimeSeconds, 72_000);
});
// R5 session retrieval is executable in complete-session-services.test.ts.
// Detailed cap/batch/error acceptance is in complete-metadata-services.test.ts.
test("R5 facets/joins (Task 17): complete facets and per-item metadata under cap 100", async () => {
  const items = Array.from({ length: 1200 }, (_, i) => ({ id: `item-${String(i).padStart(4, "0")}`, source: "Source", created_at_matter: null, updated_at_matter: null }));
  const tags = Array.from({ length: 1200 }, (_, i) => ({ id: `tag-${i}`, name: `Tag ${i}` }));
  const links = items.map((item, i) => ({ item_id: item.id, tag_id: tags[i].id }));
  for (const tag of tags.slice(1)) links.push({ item_id: items[0].id, tag_id: tag.id });
  const annotations = Array.from({ length: 1200 }, (_, i) => ({ id: `a-${i}`, item_id: items[0].id }));
  const { client } = cappedPostgrest({ matter_items: items, matter_tags: tags, item_tags: links, annotations }, { cap: 100 });
  const result = await getArticleList(client);
  assert.equal(result.total, items.length);
  assert.equal(result.articles.length, 100);
  assert.deepEqual(result.sources, [{ value: "Source", label: "Source", count: 1200 }]);
  assert.equal(result.tags.length, tags.length);
  assert.equal(result.articles[0].tags.length, 1200);
  assert.equal(result.articles[0].highlights, annotations.length);
});
test("R5 query efficiency (Task 18): actual HTTP requests and aggregate-only client payload", async () => {
  const { getOverviewReadingMetrics, toOverviewClientPayload } = await import("../lib/overview-service.js");
  const { getReadingReport, toReportsClientPayload } = await import("../lib/reports-service.js");
  const rows = Array.from({length:1200},(_,i)=>({id:`s-${String(i).padStart(6,"0")}`,item_id:null,started_at:"2026-09-10T10:00:00Z",duration_seconds:60}));
  const fixture = cappedPostgrest({reading_sessions:rows},{cap:100});
  const now = new Date("2026-09-10T18:00:00Z");
  const overview = await getOverviewReadingMetrics(fixture.client,"month",null,null,now,"Europe/Athens");
  assert.equal(overview.metrics.totals.sessionsCount,1200);
  assert.ok(fixture.requests.length <= 14, "one complete history enumeration supplies all Overview ranges");
  assert.deepEqual(Object.keys(toOverviewClientPayload(overview)),["metrics"]);
  const before = fixture.requests.length;
  const report = await getReadingReport(fixture.client,"monthly",{now,reference:"2026-09"});
  assert.ok(fixture.requests.length-before <= 29, "selected input once, one narrow history, empty comparison");
  assert.equal(report.metrics.totals.wordsRead,270000);
  assert.equal(toReportsClientPayload(report).sessionLengthHistogram[0].count,1200);
  assert.equal("timeline" in toReportsClientPayload(report),false);
});

function streakClient(dates: string[]) {
  const sessions = dates.map((started_at, index) => ({
    id: `streak-${index}`, item_id: null, started_at, ended_at: null,
    duration_seconds: 60, words_estimated: 225, matter_items: null,
  }));
  return cappedPostgrest({ reading_sessions: sessions }).client;
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
