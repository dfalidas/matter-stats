import assert from "node:assert/strict";
import test from "node:test";

import {
  compareAuthors,
  normalizeAuthorName,
  normalizeAuthorPeriod,
  normalizeAuthorSource,
  type AuthorRankingRow,
} from "../lib/authors-service";

const authors: AuthorRankingRow[] = [
  {
    author: "Toni Morrison",
    readingTimeSeconds: 900,
    articlesRead: 2,
    wordsRead: 2_100,
    topSource: "The Browser",
  },
  {
    author: "Annie Dillard",
    readingTimeSeconds: 1_200,
    articlesRead: 1,
    wordsRead: 1_900,
    topSource: "Aeon",
  },
  {
    author: "Unknown author",
    readingTimeSeconds: 600,
    articlesRead: 3,
    wordsRead: 2_400,
    topSource: "Quanta",
  },
];

test("normalizes author period query values", () => {
  assert.equal(normalizeAuthorPeriod("week"), "week");
  assert.equal(normalizeAuthorPeriod(["year", "month"]), "year");
  assert.equal(normalizeAuthorPeriod("unsupported"), "month");
});

test("normalizes missing author and source metadata", () => {
  assert.equal(normalizeAuthorName(" Ursula K. Le Guin "), "Ursula K. Le Guin");
  assert.equal(normalizeAuthorName(" "), "Unknown author");
  assert.equal(normalizeAuthorName(null), "Unknown author");
  assert.equal(normalizeAuthorSource(" The Atlantic "), "The Atlantic");
  assert.equal(normalizeAuthorSource(undefined), "Unknown source");
});

test("sorts author rankings by each supported metric", () => {
  assert.deepEqual([...authors].sort(compareAuthors("reading-time")).map((author) => author.author), [
    "Annie Dillard",
    "Toni Morrison",
    "Unknown author",
  ]);
  assert.deepEqual([...authors].sort(compareAuthors("articles")).map((author) => author.author), [
    "Unknown author",
    "Toni Morrison",
    "Annie Dillard",
  ]);
  assert.deepEqual([...authors].sort(compareAuthors("words")).map((author) => author.author), [
    "Unknown author",
    "Toni Morrison",
    "Annie Dillard",
  ]);
  assert.deepEqual([...authors].sort(compareAuthors("top-source")).map((author) => author.author), [
    "Annie Dillard",
    "Unknown author",
    "Toni Morrison",
  ]);
});
