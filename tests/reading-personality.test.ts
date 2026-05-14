import assert from "node:assert/strict";
import test from "node:test";

import type { RankedMetric, ReadingMetrics } from "../lib/metrics-service";
import { getDeterministicReadingPersonality } from "../lib/reading-personality";

function ranked(name: string, wordsRead: number, articlesRead = 3): RankedMetric {
  return {
    name,
    readingTimeSeconds: wordsRead / 3,
    wordsRead,
    articlesRead,
    sessionsCount: articlesRead,
  };
}

function metrics(overrides: Partial<ReadingMetrics>): ReadingMetrics {
  return {
    range: {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2027-01-01T00:00:00.000Z"),
      startDate: "2026-01-01",
      endDate: "2027-01-01",
      timezone: "Europe/London",
      preset: "year",
    },
    totals: {
      totalReadingTimeSeconds: 7_200,
      wordsRead: 24_000,
      articlesRead: 12,
      sessionsCount: 12,
      averageSessionLengthSeconds: 600,
    },
    currentStreakDays: 0,
    bestStreakDays: 0,
    topSources: [],
    topAuthors: [],
    topTags: [],
    recentReads: [],
    heatmap: [],
    comparison: {
      range: null,
      totals: {
        totalReadingTimeSeconds: 0,
        wordsRead: 0,
        articlesRead: 0,
        sessionsCount: 0,
        averageSessionLengthSeconds: 0,
      },
      delta: {
        totalReadingTimeSeconds: 0,
        wordsRead: 0,
        articlesRead: 0,
        sessionsCount: 0,
        averageSessionLengthSeconds: 0,
        totalReadingTimePercentChange: null,
        wordsReadPercentChange: null,
        articlesReadPercentChange: null,
        sessionsCountPercentChange: null,
        averageSessionLengthPercentChange: null,
      },
    },
    ...overrides,
  };
}

test("returns a neutral deterministic fallback for empty or low-data metrics", () => {
  const empty = metrics({
    totals: {
      totalReadingTimeSeconds: 0,
      wordsRead: 0,
      articlesRead: 0,
      sessionsCount: 0,
      averageSessionLengthSeconds: 0,
    },
  });
  const lowData = metrics({
    totals: {
      totalReadingTimeSeconds: 500,
      wordsRead: 1_800,
      articlesRead: 2,
      sessionsCount: 2,
      averageSessionLengthSeconds: 250,
    },
    topTags: [ranked("strategy", 1_000, 1)],
  });

  assert.equal(getDeterministicReadingPersonality(empty).label, "The Generalist");
  assert.equal(getDeterministicReadingPersonality(lowData).label, "The Generalist");
});

test("classifies systems-heavy topic patterns as The Systems Analyst", () => {
  const personality = getDeterministicReadingPersonality(
    metrics({
      topTags: [ranked("systems", 10_000), ranked("software engineering", 7_000), ranked("data", 4_000)],
    }),
  );

  assert.equal(personality.label, "The Systems Analyst");
  assert.match(personality.description, /systems and software engineering/);
});

test("classifies short frequent news patterns as The News Grazer", () => {
  const personality = getDeterministicReadingPersonality(
    metrics({
      totals: {
        totalReadingTimeSeconds: 4_800,
        wordsRead: 14_000,
        articlesRead: 14,
        sessionsCount: 14,
        averageSessionLengthSeconds: 343,
      },
      topTags: [ranked("news", 5_000), ranked("politics", 4_000)],
      topSources: [ranked("Reuters", 3_000), ranked("BBC", 3_000), ranked("The Guardian", 2_000), ranked("NPR", 2_000)],
    }),
  );

  assert.equal(personality.label, "The News Grazer");
});

test("classifies long research-oriented patterns as The Deep Researcher", () => {
  const personality = getDeterministicReadingPersonality(
    metrics({
      totals: {
        totalReadingTimeSeconds: 18_000,
        wordsRead: 36_000,
        articlesRead: 6,
        sessionsCount: 10,
        averageSessionLengthSeconds: 1_800,
      },
      topTags: [ranked("research", 14_000), ranked("history", 10_000), ranked("longform", 8_000)],
    }),
  );

  assert.equal(personality.label, "The Deep Researcher");
});

test("classifies business and markets patterns as The Strategy Reader", () => {
  const personality = getDeterministicReadingPersonality(
    metrics({
      topTags: [ranked("strategy", 9_000), ranked("markets", 7_000), ranked("product", 5_000)],
      topSources: [ranked("Harvard Business Review", 5_000), ranked("The Economist", 4_000)],
    }),
  );

  assert.equal(personality.label, "The Strategy Reader");
});

test("uses stable tiebreaking for equal scores", () => {
  const input = metrics({
    topTags: [ranked("science", 12_000), ranked("technology", 8_000)],
    totals: {
      totalReadingTimeSeconds: 12_000,
      wordsRead: 24_000,
      articlesRead: 6,
      sessionsCount: 8,
      averageSessionLengthSeconds: 1_500,
    },
  });

  assert.deepEqual(getDeterministicReadingPersonality(input), getDeterministicReadingPersonality(input));
});
