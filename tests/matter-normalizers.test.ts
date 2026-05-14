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

test("normalizes item numbers, progress, hostnames, and reading time estimates", () => {
  assert.deepEqual(
    normalizeMatterItem(
      {
        id: "item_2",
        title: "Numbers",
        url: "https://www.news.example/path",
        site_name: " ",
        author: { object: "author", id: "author_1", name: " Ada " },
        status: "queue",
        content_type: "article",
        word_count: 501.2,
        reading_progress: 1.5,
        created_at: "bad",
        updated_at: "2026-05-14T08:00:00Z",
      },
      "bad"
    ),
    {
      id: "item_2",
      title: "Numbers",
      url: "https://www.news.example/path",
      source: "news.example",
      author: "Ada",
      content_type: "article",
      status: "queue",
      word_count: 501,
      estimated_reading_time_minutes: Math.ceil(501 / DEFAULT_READING_SPEED_WORDS_PER_MINUTE),
      progress: 1,
      created_at_matter: null,
      updated_at_matter: "2026-05-14T08:00:00.000Z",
      last_synced_at: null,
    }
  );
});

test("normalizes sparse Matter item responses without inventing missing fields", () => {
  assert.deepEqual(normalizeMatterItem({ id: "item_3", title: " ", url: "not a url", status: "queue" }), {
    id: "item_3",
    title: null,
    url: "not a url",
    source: null,
    author: null,
    content_type: null,
    status: "queue",
    word_count: null,
    estimated_reading_time_minutes: null,
    progress: null,
    created_at_matter: null,
    updated_at_matter: null,
    last_synced_at: null,
  });
});

test("normalizes reading sessions with API aliases, explicit end times, and custom reading speeds", () => {
  assert.deepEqual(
    normalizeReadingSession(
      {
        object: "reading_session",
        id: "session_4",
        item_id: " item_4 ",
        started_at: "2026-05-14T10:00:00Z",
        ended_at: "2026-05-14T10:10:00Z",
        duration_seconds: 61.2,
        source_device: " ",
        device: "iPad",
      },
      { readingSpeedWordsPerMinute: 300 }
    ),
    {
      id: "session_4",
      item_id: "item_4",
      started_at: "2026-05-14T10:00:00.000Z",
      ended_at: "2026-05-14T10:10:00.000Z",
      duration_seconds: 61,
      source_device: "iPad",
      words_estimated: 305,
    }
  );
});

test("returns null word estimates when both duration and item progress facts are missing", () => {
  assert.deepEqual(
    normalizeReadingSession({ object: "reading_session", id: "session_5", item_id: "item_5", date: "bad", seconds_read: Number.NaN }),
    {
      id: "session_5",
      item_id: "item_5",
      started_at: null,
      ended_at: null,
      duration_seconds: null,
      source_device: null,
      words_estimated: null,
    }
  );
});
