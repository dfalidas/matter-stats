import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_APP_TIMEZONE,
  getDefaultMetricsTimezone,
  getPreviousEquivalentRange,
  getReadingMetrics,
  resolveMetricsDateRange,
} from "../lib/metrics-service";

class EmptyQuery {
  select() {
    return this;
  }

  lt() {
    return this;
  }

  gte() {
    return this;
  }

  order() {
    return this;
  }

  in() {
    return this;
  }

  then(resolve: (value: { data: never[]; error: null }) => void) {
    resolve({ data: [], error: null });
  }
}

const emptyClient = {
  from() {
    return new EmptyQuery();
  },
} as never;

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

test("resolves preset ranges as timezone-aware London calendar boundaries", () => {
  const range = resolveMetricsDateRange({ preset: "today", now: "2026-03-29T12:00:00Z", timezone: "Europe/London" });

  assert.equal(range.start?.toISOString(), "2026-03-29T00:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-03-29T23:00:00.000Z");
  assert.equal(range.startDate, "2026-03-29");
  assert.equal(range.endDate, "2026-03-30");
});

test("calculates previous equivalent period for finite ranges", () => {
  const range = resolveMetricsDateRange({ preset: "week", now: "2026-05-14T12:00:00Z", timezone: "Europe/London" });
  const previousRange = getPreviousEquivalentRange(range);

  assert.equal(range.startDate, "2026-05-11");
  assert.equal(range.endDate, "2026-05-18");
  assert.equal(previousRange?.startDate, "2026-05-04");
  assert.equal(previousRange?.endDate, "2026-05-11");
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
