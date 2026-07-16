import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_APP_TIMEZONE,
  METRICS_PERIOD_PRESETS,
  getDefaultMetricsTimezone,
  getPreviousEquivalentRange,
  getReadingMetrics,
  resolveMetricsDateRange,
} from "../lib/metrics-service";

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

class TestQuery<Row extends TestSession | TestTagRow> {
  private startedBefore: string | null = null;
  private startedAtOrAfter: string | null = null;
  private itemIds: string[] | null = null;
  private startedAtAscending: boolean | null = null;

  constructor(private readonly rows: Row[]) {}

  select() {
    return this;
  }

  lt(column: string, value: string) {
    if (column === "started_at") {
      this.startedBefore = value;
    }
    return this;
  }

  gte(column: string, value: string) {
    if (column === "started_at") {
      this.startedAtOrAfter = value;
    }
    return this;
  }

  order(column: string, options: { ascending?: boolean }) {
    if (column === "started_at") {
      this.startedAtAscending = options.ascending ?? true;
    }
    return this;
  }

  in(column: string, values: string[]) {
    if (column === "item_id") {
      this.itemIds = values;
    }
    return this;
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.result(), error: null }).then(onfulfilled, onrejected);
  }

  private result(): Row[] {
    let result = [...this.rows];

    if (this.startedBefore) {
      result = result.filter((row) => "started_at" in row && row.started_at !== null && row.started_at < this.startedBefore!);
    }

    if (this.startedAtOrAfter) {
      result = result.filter((row) => "started_at" in row && row.started_at !== null && row.started_at >= this.startedAtOrAfter!);
    }

    if (this.itemIds) {
      result = result.filter((row) => "item_id" in row && row.item_id !== null && this.itemIds!.includes(row.item_id));
    }

    if (this.startedAtAscending !== null) {
      result.sort((a, b) => {
        const left = "started_at" in a ? a.started_at ?? "" : "";
        const right = "started_at" in b ? b.started_at ?? "" : "";
        return this.startedAtAscending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }

    return result;
  }
}

function createClient({ sessions = [], tags = [] }: { sessions?: TestSession[]; tags?: TestTagRow[] }) {
  return {
    from(table: string) {
      if (table === "reading_sessions") {
        return new TestQuery(sessions);
      }

      if (table === "item_tags") {
        return new TestQuery(tags);
      }

      return new TestQuery([]);
    },
  } as never;
}

const emptyClient = createClient({});

test("defaults metrics timezone to Europe/London when APP_TIMEZONE is unset", () => {
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
    wordsRead: 1_500,
    articlesRead: 2,
    sessionsCount: 3,
    averageSessionLengthSeconds: 160,
  });
  assert.equal(metrics.currentStreakDays, 3);
  assert.equal(metrics.bestStreakDays, 3);
  assert.deepEqual(metrics.topSources, [
    { name: "Beta", readingTimeSeconds: 300, wordsRead: 1_000, articlesRead: 1, sessionsCount: 1 },
    { name: "Zeta", readingTimeSeconds: 180, wordsRead: 500, articlesRead: 1, sessionsCount: 2 },
  ]);
  assert.deepEqual(metrics.topAuthors, [
    { name: "Bob", readingTimeSeconds: 300, wordsRead: 1_000, articlesRead: 1, sessionsCount: 1 },
    { name: "Alice", readingTimeSeconds: 180, wordsRead: 500, articlesRead: 1, sessionsCount: 2 },
  ]);
  assert.deepEqual(metrics.topTags, [
    { name: "Tech", readingTimeSeconds: 480, wordsRead: 1_500, articlesRead: 2, sessionsCount: 3 },
    { name: "Longform", readingTimeSeconds: 180, wordsRead: 500, articlesRead: 1, sessionsCount: 2 },
  ]);
  assert.deepEqual(metrics.recentReads.map(({ itemId, readAt, readingTimeSeconds, wordsRead }) => ({ itemId, readAt, readingTimeSeconds, wordsRead })), [
    { itemId: "item_a", readAt: "2026-05-17T10:00:00.000Z", readingTimeSeconds: 180, wordsRead: 500 },
    { itemId: "item_b", readAt: "2026-05-15T10:00:00.000Z", readingTimeSeconds: 300, wordsRead: 1_000 },
  ]);
  assert.deepEqual(
    metrics.heatmap.filter((day) => day.readingTimeSeconds > 0),
    [
      { date: "2026-05-15", readingTimeSeconds: 300, wordsRead: 1_000, articlesRead: 1, sessionsCount: 1 },
      { date: "2026-05-16", readingTimeSeconds: 60, wordsRead: 0, articlesRead: 1, sessionsCount: 1 },
      { date: "2026-05-17", readingTimeSeconds: 120, wordsRead: 500, articlesRead: 1, sessionsCount: 1 },
    ]
  );
  assert.deepEqual(metrics.comparison.totals, {
    totalReadingTimeSeconds: 240,
    wordsRead: 600,
    articlesRead: 1,
    sessionsCount: 1,
    averageSessionLengthSeconds: 240,
  });
  assert.equal(metrics.comparison.delta.totalReadingTimeSeconds, 240);
  assert.equal(metrics.comparison.delta.totalReadingTimePercentChange, 1);
  assert.equal(metrics.comparison.delta.wordsReadPercentChange, 1.5);
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
