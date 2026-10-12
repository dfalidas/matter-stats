import assert from "node:assert/strict";
import test from "node:test";
import { getOverviewReadingMetrics } from "../lib/overview-service";
import { getReadingMetrics } from "../lib/metrics-service";
import { getActivityMonth } from "../lib/activity-service";
import { getReadingReport } from "../lib/reports-service";
import { formatReportCsv } from "../lib/report-csv";
import { getAuthorRanking } from "../lib/authors-service";
import { getSourceRanking } from "../lib/sources-service";
import { getTagRanking } from "../lib/tags-service";
import { cappedPostgrest } from "./fixtures/capped-postgrest";

const now = new Date("2026-09-10T18:00:00Z");
const timestamp = "2026-09-10T10:00:00.000000+00:00";
const item = { id: "item", title: "Synthetic", url: null, source: "Source", author: "Author", word_count: 999999, estimated_reading_time_minutes: 5 };
function sessions(count: number) {
  // Every timestamp ties; shuffled input prevents accidentally relying on input
  // order instead of the database's unique ID tie-breaker.
  return Array.from({ length: count }, (_, index) => ({
    id: `s-${String(count - index - 1).padStart(6, "0")}`, item_id: null as string | null,
    started_at: timestamp as string | null, ended_at: null, duration_seconds: 60 as number | null,
    words_estimated: 999999, matter_items: null as typeof item | null,
  }));
}

for (const [count, cap] of [[1200, 100], [1200, 300], [1200, 1000], [10037, 100]] as const) {
  test(`R5 session retrieval: Overview/Activity/Reports agree for ${count} rows, cap ${cap}`, async () => {
    const rows = sessions(count);
    const expectedIds = rows.map((row) => row.id).sort();
    const expectedSeconds = rows.reduce((sum, row) => sum + row.duration_seconds!, 0);
    const expectedWords = rows.reduce((sum, row) => sum + Math.round(row.duration_seconds! * 225 / 60), 0);
    const { client, requests } = cappedPostgrest({ reading_sessions: rows }, { cap });
    const overview = await getOverviewReadingMetrics(client, "month", null, null, now, "Europe/Athens");
    for (const metrics of [overview.metrics, overview.todayMetrics, overview.allTimeMetrics]) {
      assert.equal(metrics.totals.sessionsCount, expectedIds.length);
      assert.equal(metrics.totals.totalReadingTimeSeconds, expectedSeconds);
      assert.equal(metrics.totals.wordsRead, expectedWords);
      assert.equal(metrics.totals.articlesRead, 0);
      assert.equal(metrics.currentStreakDays, 1);
    }
    const activity = await getActivityMonth(client, "2026-09", "2026-09-10", 1, now);
    const lastPage = await getActivityMonth(client, "2026-09", "2026-09-10", Math.ceil(count / 20), now);
    assert.deepEqual(activity.dayTotal, { seconds: expectedSeconds, estimatedWords: expectedWords, sessions: count });
    assert.deepEqual(lastPage.dayTotal, activity.dayTotal);
    assert.deepEqual(lastPage.days, activity.days);
    assert.deepEqual(activity.sessions.map((row) => row.id), expectedIds.slice(0, 20));
    assert.deepEqual(lastPage.sessions.map((row) => row.id), expectedIds.slice((lastPage.page - 1) * 20));
    assert.equal(activity.days.reduce((sum, day) => sum + day.seconds, 0), expectedSeconds);
    assert.equal(activity.days.reduce((sum, day) => sum + day.sessions, 0), count);
    const report = await getReadingReport(client, "daily", { reference: "2026-09-10", now });
    assert.deepEqual(report.timeline.map((row) => row.id), expectedIds);
    assert.equal(new Set(report.timeline.map((row) => row.id)).size, count);
    assert.equal(report.timeline.reduce((sum, row) => sum + row.durationSeconds, 0), expectedSeconds);
    assert.equal(report.timeline.reduce((sum, row) => sum + row.wordsRead, 0), expectedWords);
    assert.deepEqual(report.metrics.totals, overview.todayMetrics.totals);
    const csvRows = formatReportCsv(report.metrics.heatmap).split("\n").slice(1).map((line) => line.split(","));
    assert.equal(csvRows.reduce((sum, row) => sum + Number(row[1]), 0), expectedSeconds);
    assert.equal(csvRows.reduce((sum, row) => sum + Number(row[2]), 0), expectedWords);
    assert.equal(csvRows.reduce((sum, row) => sum + Number(row[3]), 0), count);
    const pages = requests.filter((request) => request.url.searchParams.get("limit") === "500");
    assert.ok(pages.some((request) => request.ids.length === Math.min(cap, 500)));
    assert.ok(pages.some((request) => request.ids.length === 0), "explicit exhaustion query");
    assert.ok(pages.every((request) => request.url.searchParams.get("order") === "started_at.asc.nullslast,id.asc"));
    assert.ok(pages.every((request) => !request.url.searchParams.has("offset")));
    if (count === 1200) { assert.equal(expectedSeconds, 72000); assert.equal(expectedIds.length, 1200); }
  });
}

for (const count of [0, 100, 500, 501, 600]) {
  test(`complete IDs and totals for empty/exact/partial pages: ${count}`, async () => {
    const rows = sessions(count);
    const { client } = cappedPostgrest({ reading_sessions: rows }, { cap: 100 });
    const report = await getReadingReport(client, "monthly", { reference: "2026-09", now });
    assert.deepEqual(report.timeline.map((row) => row.id), rows.map((row) => row.id).sort());
    assert.equal(report.metrics.totals.sessionsCount, count);
    assert.equal(report.metrics.totals.totalReadingTimeSeconds, count * 60);
  });
}

test("complete session input reaches Authors, Sources and Tags without changing attribution", async () => {
  const rows = sessions(1200).map((row) => ({ ...row, item_id: "item", matter_items: item }));
  const { client } = cappedPostgrest({ reading_sessions: rows, item_tags: [{ item_id: "item", tag_id: "tag", matter_tags: { id: "tag", name: "Tag" } }] }, { cap: 100 });
  const options = { preset: "month" as const, now, timezone: "Europe/Athens" };
  const authors = await getAuthorRanking(client, options);
  const sources = await getSourceRanking(client, options);
  const tags = await getTagRanking(client, options);
  for (const ranking of [authors, sources, tags]) {
    assert.equal(ranking.totals.readingTimeSeconds, 72000);
    assert.equal(ranking.totals.wordsRead, 270000);
    assert.equal(ranking.totals.articlesRead, 1);
  }
  assert.equal(authors.authors[0].author, "Author");
  assert.equal(sources.sources[0].source, "Source");
  assert.equal(tags.tags[0].tag, "Tag");
});

test("null/invalid duration values preserve zero-duration sessions and per-session rounding", async () => {
  const rows = sessions(205).map((row, index) => ({ ...row, duration_seconds: [null, -5, 0, 1, 1][index % 5] }));
  const { client } = cappedPostgrest({ reading_sessions: rows }, { cap: 100 });
  const report = await getReadingReport(client, "daily", { reference: "2026-09-10", now });
  const activity = await getActivityMonth(client, "2026-09", "2026-09-10", 2, now);
  assert.equal(report.metrics.totals.sessionsCount, 205);
  assert.equal(report.metrics.totals.totalReadingTimeSeconds, 82);
  assert.equal(report.metrics.totals.wordsRead, 328);
  assert.deepEqual(activity.dayTotal, { seconds: 82, estimatedWords: 328, sessions: 205 });
  assert.equal(report.timeline.reduce((sum, row) => sum + row.wordsRead, 0), 328);
});

test("pagination preserves database microseconds and quotes opaque IDs", async () => {
  const rows = sessions(8).map((row, index) => ({ ...row,
    id: ['quote"', "back\\slash", "comma,", "dot.", "colon:", "paren()", "plain", "z"][index],
    started_at: `2026-09-10T10:00:00.${String(index + 1).padStart(6, "0")}+00:00`,
  }));
  const { client, requests } = cappedPostgrest({ reading_sessions: rows }, { cap: 1 });
  const report = await getReadingReport(client, "daily", { reference: "2026-09-10", now });
  assert.deepEqual(report.timeline.map((row) => row.id), rows.map((row) => row.id));
  assert.equal(report.metrics.totals.totalReadingTimeSeconds, 480);
  assert.ok(requests.some((r) => r.url.searchParams.get("or")?.includes(".000001+00:00")));
});

for (const fault of ["duplicate", "repeat-page", "invalid-id", "invalid-timestamp", "invalid-calendar", "null-row", "null-response", "late-error"] as const) {
  test(`complete reads reject ${fault} after a successful page`, async () => {
    // Activity makes one enumeration, so injection targets its actual third
    // HTTP request: boundary, first page, then the faulty later page.
    const rows = sessions(250);
    const { client } = cappedPostgrest({ reading_sessions: rows }, { cap: 100, respond: (request, result) => {
      if (request.number !== 3) return;
      if (fault === "late-error") return Response.json({ message: "synthetic later database failure", code: "XX000" }, { status: 500 });
      if (fault === "null-response") return Response.json(null);
      if (fault === "repeat-page") return Response.json([...rows].reverse().slice(0, 100));
      if (fault === "duplicate") return Response.json([result[0], result[0]]);
      if (fault === "invalid-id") return Response.json([{ ...result[0], id: "" }]);
      if (fault === "invalid-timestamp") return Response.json([{ ...result[0], started_at: "invalid" }]);
      if (fault === "invalid-calendar") return Response.json([{ ...result[0], started_at: "2026-02-30T10:00:00Z" }]);
      return Response.json([null]);
    } });
    await assert.rejects(getActivityMonth(client, "2026-09", "2026-09-10", 1, now), (error: unknown) => {
      const message = (error as { message: string }).message;
      return fault === "late-error" ? message === "synthetic later database failure" : /complete-session/.test(message);
    });
  });
}

test("fenced live traversal supports inserts/deletes/payload updates without offset shifts", async () => {
  const rows = sessions(250);
  const { client } = cappedPostgrest({ reading_sessions: rows }, { cap: 100, before: (request) => {
    if (request.number === 3) {
      // A fetched row is deleted; unseen rows retain their keyset positions.
      rows.splice(rows.findIndex((row) => row.id === "s-000000"), 1);
      rows.find((row) => row.id === "s-000150")!.duration_seconds = 120;
      rows.push({ ...rows[0], id: "after-fence", started_at: "2026-09-10T11:00:00Z" });
    }
  } });
  const activity = await getActivityMonth(client, "2026-09", "2026-09-10", 13, now);
  assert.equal(activity.dayTotal.sessions, 250, "already-read deletion remains in the live result");
  assert.equal(activity.dayTotal.seconds, 15060, "unseen payload update is observed");
  assert.deepEqual(activity.sessions.map((row) => row.id), Array.from({ length: 10 }, (_, i) => `s-${String(240 + i).padStart(6, "0")}`));
});

test("live consistency limitations are explicit: backdated inserts, unseen deletes and moved keys", async () => {
  const rows = sessions(250);
  const { client } = cappedPostgrest({ reading_sessions: rows }, { cap: 100, before: (request) => {
    if (request.number === 3) {
      rows.push({ ...rows[0], id: "behind-cursor", started_at: "2026-09-10T09:00:00Z" });
      rows.push({ ...rows[0], id: "s-000125-new" });
      rows.splice(rows.findIndex((row) => row.id === "s-000150"), 1);
      rows.find((row) => row.id === "s-000160")!.started_at = "2026-09-10T09:30:00Z";
    }
  } });
  const activity = await getActivityMonth(client, "2026-09", "2026-09-10", 1, now);
  assert.equal(activity.dayTotal.sessions, 249);
  assert.equal(activity.dayTotal.seconds, 14940);
});

test("an already-read ID moved forward fails closed instead of being counted twice", async () => {
  const rows = sessions(250);
  const { client } = cappedPostgrest({ reading_sessions: rows }, { cap: 100, before: (request) => {
    if (request.number === 3) rows.find((row) => row.id === "s-000000")!.started_at = "2026-09-10T10:00:00.000001Z";
  } });
  // Move within the fence, rather than beyond the greatest timestamp.
  rows.find((row) => row.id === "s-000249")!.started_at = "2026-09-10T10:00:01Z";
  await assert.rejects(getActivityMonth(client, "2026-09", "2026-09-10", 1, now), /Duplicate or non-advancing/);
});

test("current and historical streaks traverse capped history outside the selected range", async () => {
  const rows = sessions(303).map((row, index) => ({ ...row,
    started_at: `2026-09-${String(8 + Math.floor(index / 101)).padStart(2, "0")}T10:00:00Z`,
  }));
  const { client } = cappedPostgrest({ reading_sessions: rows }, { cap: 100 });
  const metrics = await getReadingMetrics(client, {
    range: { start: "2026-08-01T00:00:00Z", end: "2026-08-02T00:00:00Z" },
    now, timezone: "Europe/Athens", historicalStreakDate: "2026-09-09",
  });
  assert.equal(metrics.totals.sessionsCount, 0);
  assert.equal(metrics.currentStreakDays, 3);
  assert.deepEqual(metrics.historicalStreak, { asOfDate: "2026-09-09", days: 2 });
});

test("latest-week lookup stays bounded while the weekly report timeline is complete", async () => {
  const rows = sessions(1200);
  const { client, requests } = cappedPostgrest({ reading_sessions: rows }, { cap: 100 });
  const report = await getReadingReport(client, "weekly", { reference: "2026-09-10", now });
  assert.equal(report.latestWeekWithDataStartDate, "2026-09-07");
  assert.equal(report.timeline.length, 1200);
  const latest = requests.filter((r) => r.url.searchParams.get("select") === "started_at");
  assert.equal(latest.length, 1);
  assert.equal(latest[0].url.searchParams.get("limit"), "1");
});
