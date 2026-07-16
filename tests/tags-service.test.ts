import assert from "node:assert/strict";
import test from "node:test";

import { compareTags, getTagRanking, normalizeTagName, normalizeTagPeriod, type TagRankingRow } from "../lib/tags-service";
import type { MatterStatsSupabaseClient } from "../lib/supabase-queries";

const tags: TagRankingRow[] = [
  {
    tagId: "tag-browser",
    tag: "Browser",
    readingTimeSeconds: 900,
    wordsRead: 2_100,
    articlesRead: 2,
    highlights: 1,
    shareOfTaggedReading: 0.3,
  },
  {
    tagId: "tag-philosophy",
    tag: "Philosophy",
    readingTimeSeconds: 1_200,
    wordsRead: 1_900,
    articlesRead: 1,
    highlights: 5,
    shareOfTaggedReading: 0.4,
  },
  {
    tagId: "tag-science",
    tag: "Science",
    readingTimeSeconds: 600,
    wordsRead: 2_400,
    articlesRead: 3,
    highlights: 2,
    shareOfTaggedReading: 0.2,
  },
];

test("normalizes tag period query values", () => {
  assert.equal(normalizeTagPeriod("week"), "week");
  assert.equal(normalizeTagPeriod(["year", "month"]), "year");
  assert.equal(normalizeTagPeriod("unsupported"), "month");
});

test("normalizes blank tag names", () => {
  assert.equal(normalizeTagName(" Productivity "), "Productivity");
  assert.equal(normalizeTagName(" "), null);
  assert.equal(normalizeTagName(null), null);
});

test("sorts tag rankings by each supported metric", () => {
  assert.deepEqual([...tags].sort(compareTags("reading-time")).map((tag) => tag.tag), ["Philosophy", "Browser", "Science"]);
  assert.deepEqual([...tags].sort(compareTags("articles")).map((tag) => tag.tag), ["Science", "Browser", "Philosophy"]);
  assert.deepEqual([...tags].sort(compareTags("words")).map((tag) => tag.tag), ["Science", "Browser", "Philosophy"]);
  assert.deepEqual([...tags].sort(compareTags("highlights")).map((tag) => tag.tag), ["Philosophy", "Science", "Browser"]);
});

test("builds rankings from synced Matter tags without breaking on untagged items", async () => {
  const client = createFakeClient({
    reading_sessions: [
      { id: "session-1", item_id: "item-tagged", started_at: "2026-05-10T10:00:00.000Z", duration_seconds: 600, words_estimated: 1_500 },
      { id: "session-2", item_id: "item-untagged", started_at: "2026-05-10T11:00:00.000Z", duration_seconds: 300, words_estimated: 750 },
    ],
    item_tags: [
      { item_id: "item-tagged", tag_id: "tag-productivity", matter_tags: { id: "tag-productivity", name: "Productivity" } },
    ],
    annotations: [
      { id: "annotation-1", item_id: "item-tagged", created_at_matter: "2026-05-10T12:00:00.000Z" },
      { id: "annotation-2", item_id: "item-untagged", created_at_matter: "2026-05-10T12:30:00.000Z" },
    ],
  });

  const ranking = await getTagRanking(client, { preset: "month", now: "2026-05-14T12:00:00.000Z" });

  assert.equal(ranking.tags.length, 1);
  assert.equal(ranking.tags[0]?.tag, "Productivity");
  assert.equal(ranking.tags[0]?.readingTimeSeconds, 600);
  assert.equal(ranking.tags[0]?.wordsRead, 1_500);
  assert.equal(ranking.tags[0]?.articlesRead, 1);
  assert.equal(ranking.tags[0]?.highlights, 1);
  assert.equal(ranking.totals.readingTimeSeconds, 600);
  assert.equal(ranking.totals.wordsRead, 1_500);
  assert.equal(ranking.totals.articlesRead, 1);
  assert.equal(ranking.totals.highlights, 1);
});

type FakeRows = Record<string, Array<Record<string, unknown>>>;

function createFakeClient(rows: FakeRows): MatterStatsSupabaseClient {
  return {
    from(table: string) {
      return new FakeQuery(rows[table] ?? []);
    },
  } as unknown as MatterStatsSupabaseClient;
}

class FakeQuery {
  data: Array<Record<string, unknown>>;
  error = null;

  constructor(data: Array<Record<string, unknown>>) {
    this.data = data;
  }

  select() {
    return this;
  }

  order() {
    return this;
  }

  lt(column: string, value: string) {
    this.data = this.data.filter((row) => typeof row[column] !== "string" || row[column] < value);
    return this;
  }

  gte(column: string, value: string) {
    this.data = this.data.filter((row) => typeof row[column] !== "string" || row[column] >= value);
    return this;
  }

  in(column: string, values: string[]) {
    this.data = this.data.filter((row) => values.includes(row[column] as string));
    return this;
  }
}
