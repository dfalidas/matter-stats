import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_READING_SPEED_WORDS_PER_MINUTE,
  normalizeAnnotation,
  normalizeMatterItem,
  normalizeMatterItemTags,
  normalizeReadingSession,
} from "../lib/matter-normalizers";

test("normalizes Matter items with deterministic metadata fallbacks", () => {
  const row = normalizeMatterItem(
    {
      id: "item_1",
      object: "item",
      title: "  Example Article  ",
      url: "https://www.example.com/read/1",
      site_name: null,
      author: null,
      status: "archive",
      is_favorite: false,
      content_type: "article",
      word_count: null,
      reading_progress: Number.NaN,
      tags: [],
      updated_at: "2026-05-13T12:00:00-05:00",
    },
    "2026-05-14T00:00:00Z"
  );

  assert.deepEqual(row, {
    id: "item_1",
    title: "Example Article",
    url: "https://www.example.com/read/1",
    source: "example.com",
    author: null,
    content_type: "article",
    status: "archive",
    word_count: null,
    estimated_reading_time_minutes: null,
    progress: 1,
    created_at_matter: null,
    updated_at_matter: "2026-05-13T17:00:00.000Z",
    last_synced_at: "2026-05-14T00:00:00.000Z",
  });
});

test("normalizes tags and item tag join rows", () => {
  const rows = normalizeMatterItemTags({
    id: "item_1",
    tags: [
      { object: "tag", id: "tag_1", name: " Queue " },
      { object: "tag", id: "tag_2", name: "" },
    ],
  });

  assert.deepEqual(rows.matterTags, [
    { id: "tag_1", name: "Queue", created_at_matter: null, updated_at_matter: null },
    { id: "tag_2", name: "tag_2", created_at_matter: null, updated_at_matter: null },
  ]);
  assert.deepEqual(rows.itemTags, [
    { item_id: "item_1", tag_id: "tag_1" },
    { item_id: "item_1", tag_id: "tag_2" },
  ]);
});

test("normalizes reading sessions and estimates words from fixed reading speed when item facts are missing", () => {
  const row = normalizeReadingSession({
    object: "reading_session",
    id: "session_1",
    item_id: "item_1",
    date: "2026-05-14T10:00:00Z",
    seconds_read: 120,
  });

  assert.deepEqual(row, {
    id: "session_1",
    item_id: "item_1",
    started_at: "2026-05-14T10:00:00.000Z",
    ended_at: "2026-05-14T10:02:00.000Z",
    duration_seconds: 120,
    source_device: null,
    words_estimated: Math.round((120 / 60) * DEFAULT_READING_SPEED_WORDS_PER_MINUTE),
  });
});

test("normalizes reading session words from word count and progress when available", () => {
  const row = normalizeReadingSession(
    {
      object: "reading_session",
      id: "session_2",
      item_id: "item_1",
      date: "2026-05-14T10:00:00Z",
      seconds_read: 60,
    },
    { item: { id: "item_1", word_count: 1_000, reading_progress: 0.4 } }
  );

  assert.equal(row?.words_estimated, 400);
});

test("missing foreign keys are skipped instead of throwing", () => {
  assert.equal(
    normalizeReadingSession({ object: "reading_session", id: "session_3", date: "bad", seconds_read: Number.NaN, item_id: null }),
    null
  );
  assert.equal(
    normalizeAnnotation({ id: "annotation_1", object: "annotation", item_id: "", text: "Highlight", created_at: "bad", updated_at: "bad" }),
    null
  );
});

test("normalizes annotations without crashing on optional note text", () => {
  assert.deepEqual(
    normalizeAnnotation({
      object: "annotation",
      id: "annotation_2",
      item_id: "item_1",
      text: " Highlight ",
      note: " ",
      created_at: "2026-05-14T12:00:00Z",
      updated_at: "not a date",
    }),
    {
      id: "annotation_2",
      item_id: "item_1",
      text: "Highlight",
      note: null,
      created_at_matter: "2026-05-14T12:00:00.000Z",
      updated_at_matter: null,
    }
  );
});
