import assert from "node:assert/strict";
import test from "node:test";

import { compareSources, normalizeSourcePeriod, type SourceRankingRow } from "../lib/sources-service";

const sources: SourceRankingRow[] = [
  {
    source: "The Browser",
    readingTimeSeconds: 900,
    wordsRead: 2_100,
    articlesRead: 2,
    highlights: 1,
    shareOfReading: 0.3,
  },
  {
    source: "Aeon",
    readingTimeSeconds: 1_200,
    wordsRead: 1_900,
    articlesRead: 1,
    highlights: 5,
    shareOfReading: 0.4,
  },
  {
    source: "Quanta",
    readingTimeSeconds: 600,
    wordsRead: 2_400,
    articlesRead: 3,
    highlights: 2,
    shareOfReading: 0.2,
  },
];

test("normalizes source period query values", () => {
  assert.equal(normalizeSourcePeriod("week"), "week");
  assert.equal(normalizeSourcePeriod(["year", "month"]), "year");
  assert.equal(normalizeSourcePeriod("unsupported"), "month");
});

test("sorts source rankings by each supported metric", () => {
  assert.deepEqual([...sources].sort(compareSources("reading-time")).map((source) => source.source), [
    "Aeon",
    "The Browser",
    "Quanta",
  ]);
  assert.deepEqual([...sources].sort(compareSources("articles")).map((source) => source.source), [
    "Quanta",
    "The Browser",
    "Aeon",
  ]);
  assert.deepEqual([...sources].sort(compareSources("words")).map((source) => source.source), [
    "Quanta",
    "The Browser",
    "Aeon",
  ]);
  assert.deepEqual([...sources].sort(compareSources("highlights")).map((source) => source.source), [
    "Aeon",
    "Quanta",
    "The Browser",
  ]);
});
