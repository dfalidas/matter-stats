import { cappedPostgrest } from "./fixtures/capped-postgrest";
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_APP_TIMEZONE,
  METRICS_PERIOD_PRESETS,
  getDefaultMetricsTimezone,
  getPreviousEquivalentRange,
  getReadingMetrics,
  resolveMetricsDateRange,
  resolvePeriodToDateRanges,
} from "../lib/metrics-service";
import { localDateTimeToUtc } from "../lib/calendar";
import { formatOverviewRangeLabel, getOverviewReadingMetrics } from "../lib/overview-service";

type TestSession = {
  id: string;
  item_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  words_estimated: number | null;
  matter_items?:
    | {
        id: string;
        title: string | null;
        url: string | null;
        source: string | null;
        author: string | null;
      }
    | null;
};

type TestTagRow = {
  item_id: string | null;
  matter_tags: { id: string; name: string | null } | Array<{ id: string; name: string | null }> | null;
};

function createClient({ sessions = [], tags = [] }: { sessions?: TestSession[]; tags?: TestTagRow[] }) {
  return cappedPostgrest({ reading_sessions: sessions, item_tags: tags }).client;
}

function createRecordingClient(sessions: TestSession[]) {
  const bounds: Array<{ operator: "gte" | "lt"; value: string }> = [];
  const { client } = cappedPostgrest({ reading_sessions: sessions }, {
    before: ({url}) => {
      for (const filter of url.searchParams.getAll("started_at")) {
        if (filter.startsWith("gte.")) bounds.push({operator: "gte", value: filter.slice(4)});
        if (filter.startsWith("lt.")) bounds.push({operator: "lt", value: filter.slice(3)});
      }
    },
  });
  return { client, bounds };
}

const emptyClient = createClient({});

test("defaults metrics timezone to Europe/Athens when APP_TIMEZONE is unset", () => {
  const originalTimezone = process.env.APP_TIMEZONE;
  delete process.env.APP_TIMEZONE;

  try {
    assert.equal(getDefaultMetricsTimezone(), DEFAULT_APP_TIMEZONE);
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.APP_TIMEZONE;
    } else {
      process.env.APP_TIMEZONE = originalTimezone;
    }
  }
});

test("exports the supported period presets in UI order", () => {
  assert.deepEqual(METRICS_PERIOD_PRESETS, ["today", "week", "month", "year", "all-time"]);
});

test("resolves preset ranges as timezone-aware London calendar boundaries", () => {
  const range = resolveMetricsDateRange({ preset: "today", now: "2026-03-29T12:00:00Z", timezone: "Europe/London" });

  assert.equal(range.start?.toISOString(), "2026-03-29T00:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-03-29T23:00:00.000Z");
  assert.equal(range.startDate, "2026-03-29");
  assert.equal(range.endDate, "2026-03-30");
});

test("resolves each period preset to the expected calendar range", () => {
  const options = { now: "2026-05-14T12:00:00Z", timezone: "UTC" };

  assert.deepEqual(
    METRICS_PERIOD_PRESETS.map((preset) => {
      const range = resolveMetricsDateRange({ ...options, preset });
      return [preset, range.startDate, range.endDate];
    }),
    [
      ["today", "2026-05-14", "2026-05-15"],
      ["week", "2026-05-11", "2026-05-18"],
      ["month", "2026-05-01", "2026-06-01"],
      ["year", "2026-01-01", "2027-01-01"],
      ["all-time", null, "2026-05-15"],
    ]
  );
});

test("resolves custom date ranges and leaves open starts unbounded", () => {
  const finiteRange = resolveMetricsDateRange({
    range: { start: "2026-05-01T10:30:00Z", end: "2026-05-07T20:00:00Z" },
    timezone: "UTC",
  });
  const openRange = resolveMetricsDateRange({ range: { start: null }, now: "2026-05-14T12:00:00Z", timezone: "UTC" });

  assert.equal(finiteRange.preset, "custom");
  assert.equal(finiteRange.start?.toISOString(), "2026-05-01T10:30:00.000Z");
  assert.equal(finiteRange.end.toISOString(), "2026-05-07T20:00:00.000Z");
  assert.equal(openRange.start, null);
  assert.equal(openRange.endDate, "2026-05-15");
});

test("calculates previous equivalent period for finite ranges", () => {
  const range = resolveMetricsDateRange({ preset: "week", now: "2026-05-14T12:00:00Z", timezone: "Europe/London" });
  const previousRange = getPreviousEquivalentRange(range);

  assert.equal(range.startDate, "2026-05-11");
  assert.equal(range.endDate, "2026-05-18");
  assert.equal(previousRange?.startDate, "2026-05-04");
  assert.equal(previousRange?.endDate, "2026-05-11");
});

test("calculates previous calendar month for month-over-month comparisons", () => {
  const range = resolveMetricsDateRange({ preset: "month", now: "2026-05-14T12:00:00Z", timezone: "Europe/London" });
  const previousRange = getPreviousEquivalentRange(range);

  assert.equal(range.startDate, "2026-05-01");
  assert.equal(range.endDate, "2026-06-01");
  assert.equal(previousRange?.startDate, "2026-04-01");
  assert.equal(previousRange?.endDate, "2026-05-01");
});

test("Overview month-to-date uses one intraday now and clamps short months", async () => {
  const now = new Date("2026-03-31T09:00:00.000Z"); // 12:00 Athens
  const windows = resolvePeriodToDateRanges("month", now, "Europe/Athens");
  assert.equal(windows.range.start.toISOString(), "2026-02-28T22:00:00.000Z");
  assert.equal(windows.range.end.toISOString(), now.toISOString());
  assert.equal(windows.comparisonRange.start.toISOString(), "2026-01-31T22:00:00.000Z");
  assert.equal(windows.comparisonRange.end.toISOString(), "2026-02-28T10:00:00.000Z");

  const sessions: TestSession[] = [
    { id: "previous", item_id: "p", started_at: "2026-02-28T09:59:59.000Z", ended_at: null, duration_seconds: 60, words_estimated: null },
    { id: "current", item_id: "c", started_at: "2026-03-31T08:59:59.000Z", ended_at: null, duration_seconds: 120, words_estimated: null },
    { id: "boundary", item_id: "x", started_at: now.toISOString(), ended_at: null, duration_seconds: 999, words_estimated: null },
  ];
  const metrics = await getReadingMetrics(createClient({ sessions }), { ...windows, now, timezone: "Europe/Athens" });
  assert.equal(metrics.totals.totalReadingTimeSeconds, 120);
  assert.equal(metrics.comparison.totals.totalReadingTimeSeconds, 60);
  assert.equal(metrics.comparison.delta.totalReadingTimePercentChange, 1);
  assert.equal(metrics.heatmap.at(-1)?.date, "2026-03-31");
});

test("Overview period-to-date clamps leap years and preserves DST wall time", () => {
  const leap = resolvePeriodToDateRanges("year", new Date("2028-02-29T10:00:00.000Z"), "Europe/Athens");
  assert.equal(leap.comparisonRange.end.toISOString(), "2027-02-28T10:00:00.000Z");
  const dstDay = resolvePeriodToDateRanges("today", new Date("2026-03-29T01:30:00.000Z"), "Europe/Athens");
  assert.equal(dstDay.comparisonRange.end.toISOString(), "2026-03-28T02:30:00.000Z");
});

test("local wall-time conversion advances gaps and chooses the earlier repeated time", () => {
  const base = { year: 2026, month: 3, day: 29, hour: 3, minute: 30, second: 0, millisecond: 0 };
  assert.equal(localDateTimeToUtc(base, "Europe/Athens").toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(localDateTimeToUtc({ ...base, month: 10, day: 25 }, "Europe/Athens").toISOString(), "2026-10-25T00:30:00.000Z");
});

test("Overview production caller normalizes cross-month and DST comparison ends", async () => {
  const now = new Date("2026-04-05T09:00:00.000Z");
  const sessions: TestSession[] = [
    { id: "previous-in", item_id: "p", started_at: "2026-03-29T08:59:59.000Z", ended_at: null, duration_seconds: 60, words_estimated: 999 },
    { id: "previous-edge", item_id: "e", started_at: "2026-03-29T09:00:00.000Z", ended_at: null, duration_seconds: 180, words_estimated: 999 },
    { id: "previous-after", item_id: "a", started_at: "2026-03-29T09:30:00.000Z", ended_at: null, duration_seconds: 120, words_estimated: 999 },
    { id: "current", item_id: "c", started_at: "2026-04-05T08:59:59.000Z", ended_at: null, duration_seconds: 120, words_estimated: 999 },
  ];
  const { client, bounds } = createRecordingClient(sessions);
  const { metrics } = await getOverviewReadingMetrics(client, "week", null, null, now, "Europe/Athens");
  assert.equal(metrics.range.start?.toISOString(), "2026-03-29T21:00:00.000Z");
  assert.equal(metrics.range.end.toISOString(), now.toISOString());
  assert.equal(metrics.comparison.range?.start?.toISOString(), "2026-03-22T22:00:00.000Z");
  assert.equal(metrics.comparison.range?.end.toISOString(), "2026-03-29T09:00:00.000Z");
  assert.equal(metrics.totals.totalReadingTimeSeconds, 120);
  assert.equal(metrics.totals.wordsRead, 450);
  assert.equal(metrics.comparison.totals.totalReadingTimeSeconds, 60);
  assert.equal(metrics.comparison.totals.wordsRead, 225);
  assert.equal(metrics.comparison.delta.totalReadingTimePercentChange, 1);
  assert.equal(metrics.heatmap.reduce((sum, day) => sum + day.readingTimeSeconds, 0), 120);
  assert.ok(bounds.some((bound) => bound.operator === "gte" && bound.value === "2026-03-22T22:00:00.000Z"));
  assert.ok(bounds.some((bound) => bound.operator === "lt" && bound.value === "2026-03-29T09:00:00.000Z"));
  assert.equal(formatOverviewRangeLabel(metrics), "30 Mar – 5 Apr 2026 · Europe/Athens");
});

test("Overview production caller handles normalized day shifts and repeated times", async () => {
  const empty = createClient({});
  const day = await getOverviewReadingMetrics(empty, "today", null, null, new Date("2026-03-31T21:30:00.000Z"), "Europe/Athens");
  assert.equal(day.metrics.comparison.range?.end.toISOString(), "2026-03-30T21:30:00.000Z");
  const repeated = await getOverviewReadingMetrics(empty, "week", null, null, new Date("2026-11-01T01:30:00.000Z"), "Europe/Athens");
  assert.equal(repeated.metrics.comparison.range?.end.toISOString(), "2026-10-25T00:30:00.000Z");
});

test("Overview empty period-to-date windows have no heatmap buckets and use as-of labels", async () => {
  const empty = createClient({});
  const fixtures: Array<["today" | "week" | "month" | "year", string, string]> = [
    ["today", "2026-04-01T21:00:00.000Z", "As of 2 Apr 2026 · Europe/Athens"],
    ["week", "2026-04-05T21:00:00.000Z", "As of 6 Apr 2026 · Europe/Athens"],
    ["month", "2026-03-31T21:00:00.000Z", "As of 1 Apr 2026 · Europe/Athens"],
    ["year", "2025-12-31T22:00:00.000Z", "As of 1 Jan 2026 · Europe/Athens"],
  ];
  for (const [period, timestamp, label] of fixtures) {
    const { metrics } = await getOverviewReadingMetrics(empty, period, null, null, new Date(timestamp), "Europe/Athens");
    assert.equal(metrics.range.start?.getTime(), metrics.range.end.getTime());
    assert.deepEqual(metrics.heatmap, []);
    assert.equal(formatOverviewRangeLabel(metrics), label);
  }
});

test("returns typed zero metrics for an empty data set", async () => {
  const metrics = await getReadingMetrics(emptyClient, {
    preset: "today",
    now: "2026-05-14T12:00:00Z",
    timezone: "Europe/London",
  });

  assert.deepEqual(metrics.totals, {
    totalReadingTimeSeconds: 0,
    wordsRead: 0,
    articlesRead: 0,
    sessionsCount: 0,
    averageSessionLengthSeconds: 0,
  });
  assert.equal(metrics.currentStreakDays, 0);
  assert.equal(metrics.bestStreakDays, 0);
  assert.deepEqual(metrics.topSources, []);
  assert.deepEqual(metrics.topAuthors, []);
  assert.deepEqual(metrics.topTags, []);
  assert.deepEqual(metrics.recentReads, []);
  assert.equal(metrics.heatmap.length, 1);
  assert.deepEqual(metrics.heatmap[0], {
    date: "2026-05-14",
    readingTimeSeconds: 0,
    wordsRead: 0,
    articlesRead: 0,
    sessionsCount: 0,
  });
  assert.deepEqual(metrics.comparison.totals, metrics.totals);
  assert.equal(metrics.comparison.delta.totalReadingTimePercentChange, 0);
});



test("counts reading time from sessions even when item_id is null", async () => {
  const client = createClient({
    sessions: [
      {
        id: "null_item_1",
        item_id: null,
        started_at: "2026-05-18T14:00:00.000Z",
        ended_at: "2026-05-18T14:02:00.000Z",
        duration_seconds: 120,
        words_estimated: 450,
        matter_items: null,
      },
    ],
  });

  const metrics = await getReadingMetrics(client, { preset: "week", now: "2026-05-18T18:00:00Z", timezone: "UTC" });

  assert.equal(metrics.totals.totalReadingTimeSeconds, 120);
  assert.equal(metrics.totals.sessionsCount, 1);
  assert.equal(metrics.totals.articlesRead, 0);
  assert.equal(metrics.recentReads[0]?.title, "Unknown item");
});
test("aggregates reading metrics, rankings, heatmap, recency, comparison, and streaks", async () => {
  const client = createClient({
    sessions: [
      {
        id: "previous_1",
        item_id: "previous_item",
        started_at: "2026-05-10T09:00:00.000Z",
        ended_at: "2026-05-10T09:04:00.000Z",
        duration_seconds: 240,
        words_estimated: 600,
        matter_items: { id: "previous_item", title: "Previous", url: null, source: "Archive", author: "Pat" },
      },
      {
        id: "range_1",
        item_id: "item_a",
        started_at: "2026-05-17T10:00:00.000Z",
        ended_at: "2026-05-17T10:02:00.000Z",
        duration_seconds: 120,
        words_estimated: 500,
        matter_items: { id: "item_a", title: "Alpha", url: "https://example.com/a", source: "Zeta", author: "Alice" },
      },
      {
        id: "range_2",
        item_id: "item_a",
        started_at: "2026-05-16T10:00:00.000Z",
        ended_at: "2026-05-16T10:01:00.000Z",
        duration_seconds: 60,
        words_estimated: null,
        matter_items: { id: "item_a", title: "Alpha", url: "https://example.com/a", source: "Zeta", author: "Alice" },
      },
      {
        id: "range_3",
        item_id: "item_b",
        started_at: "2026-05-15T10:00:00.000Z",
        ended_at: "2026-05-15T10:05:00.000Z",
        duration_seconds: 300,
        words_estimated: 1_000,
        matter_items: { id: "item_b", title: "Beta", url: "https://example.com/b", source: "Beta", author: "Bob" },
      },
    ],
    tags: [
      { item_id: "item_a", matter_tags: [{ id: "tag_1", name: "Tech" }, { id: "tag_2", name: "Longform" }] },
      { item_id: "item_b", matter_tags: { id: "tag_1", name: "Tech" } },
      { item_id: "previous_item", matter_tags: { id: "tag_3", name: "Ignored previous tag" } },
    ],
  });

  const metrics = await getReadingMetrics(client, {
    preset: "week",
    now: "2026-05-17T12:00:00Z",
    timezone: "UTC",
    topLimit: 5,
    recentLimit: 5,
  });

  assert.deepEqual(metrics.totals, {
    totalReadingTimeSeconds: 480,
    wordsRead: 1_800,
    articlesRead: 2,
    sessionsCount: 3,
    averageSessionLengthSeconds: 160,
  });
  assert.equal(metrics.currentStreakDays, 3);
  assert.equal(metrics.bestStreakDays, 3);
  assert.deepEqual(metrics.topSources, [
    { name: "Beta", readingTimeSeconds: 300, wordsRead: 1_125, articlesRead: 1, sessionsCount: 1 },
    { name: "Zeta", readingTimeSeconds: 180, wordsRead: 675, articlesRead: 1, sessionsCount: 2 },
  ]);
  assert.deepEqual(metrics.topAuthors, [
    { name: "Bob", readingTimeSeconds: 300, wordsRead: 1_125, articlesRead: 1, sessionsCount: 1 },
    { name: "Alice", readingTimeSeconds: 180, wordsRead: 675, articlesRead: 1, sessionsCount: 2 },
  ]);
  assert.deepEqual(metrics.topTags, [
    { name: "Tech", readingTimeSeconds: 480, wordsRead: 1_800, articlesRead: 2, sessionsCount: 3 },
    { name: "Longform", readingTimeSeconds: 180, wordsRead: 675, articlesRead: 1, sessionsCount: 2 },
  ]);
  assert.deepEqual(metrics.recentReads.map(({ itemId, readAt, readingTimeSeconds, wordsRead }) => ({ itemId, readAt, readingTimeSeconds, wordsRead })), [
    { itemId: "item_a", readAt: "2026-05-17T10:00:00.000Z", readingTimeSeconds: 180, wordsRead: 675 },
    { itemId: "item_b", readAt: "2026-05-15T10:00:00.000Z", readingTimeSeconds: 300, wordsRead: 1_125 },
  ]);
  assert.deepEqual(
    metrics.heatmap.filter((day) => day.readingTimeSeconds > 0),
    [
      { date: "2026-05-15", readingTimeSeconds: 300, wordsRead: 1_125, articlesRead: 1, sessionsCount: 1 },
      { date: "2026-05-16", readingTimeSeconds: 60, wordsRead: 225, articlesRead: 1, sessionsCount: 1 },
      { date: "2026-05-17", readingTimeSeconds: 120, wordsRead: 450, articlesRead: 1, sessionsCount: 1 },
    ]
  );
  assert.deepEqual(metrics.comparison.totals, {
    totalReadingTimeSeconds: 240,
    wordsRead: 900,
    articlesRead: 1,
    sessionsCount: 1,
    averageSessionLengthSeconds: 240,
  });
  assert.equal(metrics.comparison.delta.totalReadingTimeSeconds, 240);
  assert.equal(metrics.comparison.delta.totalReadingTimePercentChange, 1);
  assert.equal(metrics.comparison.delta.wordsReadPercentChange, 1);
});

test("ignores empty and non-positive session fields when building critical metrics", async () => {
  const metrics = await getReadingMetrics(
    createClient({
      sessions: [
        {
          id: "empty_fields",
          item_id: "",
          started_at: "2026-05-14T10:00:00.000Z",
          ended_at: null,
          duration_seconds: -25,
          words_estimated: Number.NaN,
          matter_items: null,
        },
      ],
    }),
    { preset: "today", now: "2026-05-14T12:00:00Z", timezone: "UTC" }
  );

  assert.deepEqual(metrics.totals, {
    totalReadingTimeSeconds: 0,
    wordsRead: 0,
    articlesRead: 0,
    sessionsCount: 1,
    averageSessionLengthSeconds: 0,
  });
  assert.equal(metrics.currentStreakDays, 0);
  assert.deepEqual(metrics.topSources, []);
  assert.deepEqual(metrics.recentReads, [
    {
      itemId: "",
      title: "Unknown item",
      url: null,
      source: null,
      author: null,
      readAt: "2026-05-14T10:00:00.000Z",
      readingTimeSeconds: 0,
      wordsRead: 0,
    },
  ]);
});

test("dashboard metrics work with partial item metadata", async () => {
  const metrics = await getReadingMetrics(
    createClient({
      sessions: [
        {
          id: "partial_1",
          item_id: "linked_item_without_metadata",
          started_at: "2026-05-14T10:00:00.000Z",
          ended_at: "2026-05-14T10:05:00.000Z",
          duration_seconds: 300,
          words_estimated: 1_125,
          matter_items: { id: "linked_item_without_metadata", title: "Unknown item", url: null, source: null, author: null },
        },
      ],
    }),
    { preset: "today", now: "2026-05-14T12:00:00Z", timezone: "UTC" }
  );

  assert.deepEqual(metrics.totals, {
    totalReadingTimeSeconds: 300,
    wordsRead: 1_125,
    articlesRead: 1,
    sessionsCount: 1,
    averageSessionLengthSeconds: 300,
  });
  assert.equal(metrics.currentStreakDays, 1);
  assert.deepEqual(metrics.topSources, []);
  assert.deepEqual(metrics.topAuthors, []);
  assert.deepEqual(metrics.recentReads, [
    {
      itemId: "linked_item_without_metadata",
      title: "Unknown item",
      url: null,
      source: null,
      author: null,
      readAt: "2026-05-14T10:00:00.000Z",
      readingTimeSeconds: 300,
      wordsRead: 1_125,
    },
  ]);
});

function unlinkedSession(id: string, startedAt: string, durationSeconds = 60, wordsEstimated = 225): TestSession {
  return {
    id,
    item_id: null,
    started_at: startedAt,
    ended_at: null,
    duration_seconds: durationSeconds,
    words_estimated: wordsEstimated,
    matter_items: null,
  };
}

test("current streak is independent of every reporting preset and an excluding custom range", async () => {
  const sessions = [
    unlinkedSession("sep-26", "2026-09-26T09:00:00Z"),
    unlinkedSession("sep-27-a", "2026-09-27T09:00:00Z"),
    unlinkedSession("sep-27-b", "2026-09-27T18:00:00Z"),
    unlinkedSession("sep-28", "2026-09-28T09:00:00Z"),
  ];
  const client = createClient({ sessions });

  for (const preset of METRICS_PERIOD_PRESETS) {
    const metrics = await getReadingMetrics(client, { preset, now: "2026-09-28T12:00:00Z", timezone: "UTC" });
    assert.equal(metrics.currentStreakDays, 3, preset);
  }

  const custom = await getReadingMetrics(client, {
    range: { start: "2026-08-01T00:00:00Z", end: "2026-08-02T00:00:00Z" },
    now: "2026-09-28T12:00:00Z",
    timezone: "UTC",
  });
  assert.equal(custom.currentStreakDays, 3);
  assert.equal(custom.totals.totalReadingTimeSeconds, 0);
  assert.equal(custom.bestStreakDays, 0);
});

test("current and explicit historical streaks apply today/yesterday/gap semantics", async () => {
  const client = createClient({
    sessions: [
      unlinkedSession("sep-26", "2026-09-26T09:00:00Z"),
      unlinkedSession("sep-27", "2026-09-27T09:00:00Z"),
      unlinkedSession("sep-28", "2026-09-28T09:00:00Z"),
      unlinkedSession("legacy-zero", "2026-09-29T09:00:00Z", 0, 9_999),
    ],
  });

  const yesterdayCarry = await getReadingMetrics(client, {
    preset: "today",
    now: "2026-09-29T12:00:00Z",
    timezone: "UTC",
    historicalStreakDate: "2026-09-28",
  });
  assert.equal(yesterdayCarry.currentStreakDays, 3);
  assert.deepEqual(yesterdayCarry.historicalStreak, { asOfDate: "2026-09-28", days: 3 });

  const expired = await getReadingMetrics(client, { preset: "today", now: "2026-09-30T12:00:00Z", timezone: "UTC" });
  assert.equal(expired.currentStreakDays, 0);
  assert.equal(expired.historicalStreak, null);
});

test("streak dates use Athens midnight and local calendar arithmetic across DST and year boundaries", async () => {
  const athens = await getReadingMetrics(createClient({ sessions: [
    unlinkedSession("before-midnight", "2026-09-27T20:59:00Z"),
    unlinkedSession("after-midnight", "2026-09-27T21:01:00Z"),
  ] }), { preset: "today", now: "2026-09-27T21:30:00Z", timezone: "Europe/Athens" });
  assert.equal(athens.currentStreakDays, 2);
  assert.equal(athens.totals.sessionsCount, 1);

  const boundaries = await getReadingMetrics(createClient({ sessions: [
    unlinkedSession("year-1", "2026-12-30T22:30:00Z"),
    unlinkedSession("year-2", "2026-12-31T22:30:00Z"),
    unlinkedSession("dst-1", "2026-10-24T21:30:00Z"),
    unlinkedSession("dst-2", "2026-10-25T22:30:00Z"),
  ] }), {
    preset: "year",
    now: "2027-01-01T10:00:00Z",
    timezone: "Europe/Athens",
    historicalStreakDate: "2026-10-26",
  });
  assert.equal(boundaries.currentStreakDays, 2);
  assert.deepEqual(boundaries.historicalStreak, { asOfDate: "2026-10-26", days: 2 });
});

test("daily metrics include start, exclude end, and count both Athens repeated-hour sessions", async () => {
  const metrics = await getReadingMetrics(createClient({ sessions: [
    unlinkedSession("before", "2026-10-24T20:59:59.999Z"),
    unlinkedSession("start", "2026-10-24T21:00:00.000Z"),
    unlinkedSession("repeated-one", "2026-10-25T00:30:00.000Z"),
    unlinkedSession("repeated-two", "2026-10-25T01:30:00.000Z"),
    unlinkedSession("end", "2026-10-25T22:00:00.000Z"),
  ] }), { preset: "today", now: "2026-10-25T12:00:00Z", timezone: "Europe/Athens" });
  assert.equal(metrics.range.start?.toISOString(), "2026-10-24T21:00:00.000Z");
  assert.equal(metrics.range.end.toISOString(), "2026-10-25T22:00:00.000Z");
  assert.equal(metrics.totals.sessionsCount, 3);
});

test("rounds each tiny session before totals, rankings, heatmap, and grouped recent reads", async () => {
  const item = { id: "same", title: "Same", url: null, source: "Source", author: "Author" };
  const sessions: TestSession[] = [0, 1, 2].map((index) => ({
    id: `tiny_${index}`,
    item_id: "same",
    started_at: `2026-10-04T10:00:0${index}.000Z`,
    ended_at: null,
    duration_seconds: 1,
    words_estimated: index === 0 ? 999_999 : null,
    matter_items: item,
  }));
  sessions.push(unlinkedSession("unlinked-zero", "2026-10-04T11:00:00.000Z", 0, 700));
  const metrics = await getReadingMetrics(createClient({ sessions, tags: [{ item_id: "same", matter_tags: { id: "tag", name: "Tag" } }] }), {
    preset: "today", now: "2026-10-04T12:00:00Z", timezone: "UTC",
  });
  assert.equal(metrics.totals.wordsRead, 12);
  assert.equal(metrics.topSources[0]?.wordsRead, 12);
  assert.equal(metrics.topAuthors[0]?.wordsRead, 12);
  assert.equal(metrics.topTags[0]?.wordsRead, 12);
  assert.equal(metrics.recentReads.find((read) => read.itemId === "same")?.wordsRead, 12);
  assert.equal(metrics.heatmap[0]?.wordsRead, 12);
});
