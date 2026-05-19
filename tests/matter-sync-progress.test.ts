import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  addMatterBatchCounts,
  buildMatterRateLimitMessage,
  buildMatterSyncMessage,
  buildRateLimitedMatterSyncState,
  collectLinkedMatterItemIds,
  createEmptyMatterBatchCounts,
  getMatterSyncInitialPhase,
  getMatterSyncItemsLimit,
  getMatterSyncSessionsLimit,
  getRecentActivityWindowStart,
  isMatterRateLimitActive,
  matterPageHasMore,
  normalizeRecentActivityWindow,
  MATTER_SYNC_BATCH_LIMIT,
  parseRetryAfterHeader,
  shouldDisableMatterSyncButton,
} from "../lib/matter-sync-progress";

test("uses conservative Matter sync limits by default", () => {
  assert.equal(MATTER_SYNC_BATCH_LIMIT, 25);
  assert.equal(getMatterSyncItemsLimit({}), 25);
  assert.equal(getMatterSyncSessionsLimit({}), 25);
});

test("allows Matter sync limits to be configured with environment variables", () => {
  assert.equal(getMatterSyncItemsLimit({ MATTER_SYNC_ITEMS_LIMIT: "10" }), 10);
  assert.equal(getMatterSyncSessionsLimit({ MATTER_SYNC_SESSIONS_LIMIT: "15" }), 15);
  assert.equal(getMatterSyncItemsLimit({ MATTER_SYNC_ITEMS_LIMIT: "0" }), 25);
  assert.equal(getMatterSyncSessionsLimit({ MATTER_SYNC_SESSIONS_LIMIT: "not-a-number" }), 25);
});

test("builds clear messaging when a bounded batch has more data remaining", () => {
  const message = buildMatterSyncMessage({ items: 25, sessions: 0, annotations: 4, tags: 12 }, true);

  assert.match(message, /Recent activity sync started/);
  assert.match(message, /Imported 0 reading sessions, 25 linked items, 4 annotations, and 12 tags/);
  assert.match(message, /More recent activity remains — click Sync again/);
});

test("builds clear messaging when sync completes", () => {
  const message = buildMatterSyncMessage({ items: 0, sessions: 25, annotations: 0, tags: 0 }, false);

  assert.match(message, /Recent activity sync complete/);
  assert.match(message, /Imported 25 reading sessions, 0 linked items, 0 annotations, and 0 tags/);
  assert.doesNotMatch(message, /More data remains/);
});

test("starts recent activity sync at sessions and library backfill at items", () => {
  assert.equal(getMatterSyncInitialPhase("recent_activity"), "sessions");
  assert.equal(getMatterSyncInitialPhase("backfill_library"), "items");
});

test("uses the current year as the default recent activity window", () => {
  assert.equal(getRecentActivityWindowStart(new Date("2026-05-15T12:00:00.000Z")), "2026-01-01T00:00:00.000Z");
});

test("deduplicates linked Matter item IDs for session-first sync", () => {
  assert.deepEqual(
    collectLinkedMatterItemIds([
      { item_id: " item_a " },
      { item_id: "item_b" },
      { itemId: "item_c" },
      { object: "itm_123" },
      { item: { id: "item_d" } },
      { item: "item_e" },
      { item_id: "item_a" },
      { item_id: null },
      {},
    ]),
    ["item_a", "item_b", "item_c", "itm_123", "item_d", "item_e"]
  );
});

test("adds batch counts without mutating the previous count objects", () => {
  const first = createEmptyMatterBatchCounts();
  const second = { items: 2, sessions: 3, annotations: 5, tags: 7 };
  const combined = addMatterBatchCounts(first, second);

  assert.deepEqual(combined, second);
  assert.deepEqual(first, { items: 0, sessions: 0, annotations: 0, tags: 0 });
});

test("parses Retry-After seconds and HTTP dates", () => {
  const now = Date.parse("2026-05-15T12:00:00.000Z");

  assert.equal(parseRetryAfterHeader("120", now), 120);
  assert.equal(parseRetryAfterHeader("Fri, 15 May 2026 12:01:30 GMT", now), 90);
  assert.equal(parseRetryAfterHeader("Fri, 15 May 2026 11:59:00 GMT", now), 0);
  assert.equal(parseRetryAfterHeader("invalid", now), null);
  assert.equal(parseRetryAfterHeader(null, now), null);
});

test("builds friendly rate-limit messages", () => {
  const retryAt = "2026-05-15T12:01:30.000Z";

  assert.match(buildMatterRateLimitMessage(retryAt), /Matter rate limit reached\. Try again after/);
  assert.match(buildMatterRateLimitMessage(retryAt), /2026/);
});

test("detects active rate limits for server-side and client-side protection", () => {
  const now = new Date("2026-05-15T12:00:00.000Z");

  assert.equal(isMatterRateLimitActive("2026-05-15T12:01:00.000Z", now), true);
  assert.equal(isMatterRateLimitActive("2026-05-15T11:59:00.000Z", now), false);
  assert.equal(isMatterRateLimitActive(null, now), false);
});

test("disables the sync button while pending or while rate-limited", () => {
  const now = new Date("2026-05-15T12:00:00.000Z");

  assert.equal(shouldDisableMatterSyncButton({ isPending: true, now }), true);
  assert.equal(shouldDisableMatterSyncButton({ isPending: false, rateLimitedUntil: "2026-05-15T12:01:00.000Z", now }), true);
  assert.equal(shouldDisableMatterSyncButton({ isPending: false, rateLimitedUntil: "2026-05-15T11:59:00.000Z", now }), false);
});

test("preserves checkpoints when storing Matter rate limits after a 429", () => {
  const storedState = {
    completed_checkpoint_timestamp: "2026-05-14T00:00:00.000Z",
    active_since_timestamp: "2026-05-14T00:00:00.000Z",
    active_phase: "items",
    item_cursor: "cursor_1",
    tag_cursor: null,
    session_cursor: null,
    next_checkpoint_timestamp: "2026-05-14T00:05:00.000Z",
    sync_mode: "recent_activity",
    recent_activity_checkpoint: "2026-05-14T00:02:00.000Z",
    backfill_items_cursor: "item_cursor_1",
  };

  const rateLimitedState = buildRateLimitedMatterSyncState(storedState, "2026-05-15T12:01:00.000Z");

  assert.equal(rateLimitedState.completed_checkpoint_timestamp, storedState.completed_checkpoint_timestamp);
  assert.equal(rateLimitedState.next_checkpoint_timestamp, storedState.next_checkpoint_timestamp);
  assert.equal(rateLimitedState.item_cursor, storedState.item_cursor);
  assert.equal(rateLimitedState.rate_limited_until, "2026-05-15T12:01:00.000Z");
  assert.equal(rateLimitedState.recent_activity_checkpoint, storedState.recent_activity_checkpoint);
  assert.equal(rateLimitedState.backfill_items_cursor, storedState.backfill_items_cursor);
});

test("builds no-session guidance when recent activity returns zero sessions and no more pages", () => {
  const message = buildMatterSyncMessage({ items: 0, sessions: 0, annotations: 0, tags: 0 }, false, "recent_activity");

  assert.equal(message, "No recent reading sessions found. Try expanding the sync window or confirm Matter has reading-session data.");
  assert.doesNotMatch(message, /More recent activity remains/);
});

test("keeps more-remains messaging when Matter returns zero sessions with has_more", () => {
  const message = buildMatterSyncMessage({ items: 0, sessions: 0, annotations: 0, tags: 0 }, true, "recent_activity");

  assert.match(message, /More recent activity remains — click Sync again/);
});

test("detects Matter pagination from either has_more or next_cursor", () => {
  assert.equal(matterPageHasMore({ has_more: false, next_cursor: null }), false);
  assert.equal(matterPageHasMore({ has_more: true, next_cursor: null }), true);
  assert.equal(matterPageHasMore({ has_more: false, next_cursor: "cursor_1" }), true);
});

test("supports selectable recent activity windows", () => {
  const now = new Date("2026-05-15T12:00:00.000Z");

  assert.equal(getRecentActivityWindowStart(now, "7_days"), "2026-05-08T12:00:00.000Z");
  assert.equal(getRecentActivityWindowStart(now, "30_days"), "2026-04-15T12:00:00.000Z");
  assert.equal(getRecentActivityWindowStart(now, "90_days"), "2026-02-14T12:00:00.000Z");
  assert.equal(getRecentActivityWindowStart(now, "current_year"), "2026-01-01T00:00:00.000Z");
  assert.equal(getRecentActivityWindowStart(now, "all"), null);
  assert.equal(normalizeRecentActivityWindow("90_days"), "90_days");
  assert.equal(normalizeRecentActivityWindow("bad"), "current_year");
});

test("documents sessions-first flow before linked item import", () => {
  const sessions = [{ item_id: "item_a" }, { object: "itm_item_b" }];

  assert.equal(getMatterSyncInitialPhase("recent_activity"), "sessions");
  assert.deepEqual(collectLinkedMatterItemIds(sessions), ["item_a", "itm_item_b"]);
});


test("includes unavailable item metadata note when sessions import without item links", () => {
  const message = buildMatterSyncMessage(
    { items: 0, sessions: 0, annotations: 0, tags: 0 },
    true,
    "recent_activity",
    { sessionsReturned: 25, sessionsSkipped: 0, sessionsWithoutLinkedItem: 25 }
  );

  assert.match(message, /Imported 0 reading sessions/);
  assert.match(message, /Item metadata unavailable for these sessions/);
});

test("reports partial session skips without hiding successful imports", () => {
  const message = buildMatterSyncMessage(
    { items: 2, sessions: 24, annotations: 0, tags: 0 },
    true,
    "recent_activity",
    { sessionsReturned: 25, sessionsSkipped: 1 }
  );

  assert.match(message, /Imported 24 reading sessions, 2 linked items/);
  assert.match(message, /Skipped 1 sessions/);
  assert.match(message, /More recent activity remains/);
});


test("imports linked matter_items before upserting reading_sessions", () => {
  const source = readFileSync("lib/matter-sync.ts", "utf8");
  const sessionImportStart = source.indexOf("async function importMatterSessionPage");
  const linkedImportIndex = source.indexOf("await importLinkedMatterItems", sessionImportStart);
  const sessionUpsertIndex = source.indexOf("await upsertInBatches(sessionRows, upsertReadingSessions)", sessionImportStart);
  const linkedImportStart = source.indexOf("async function importLinkedMatterItems");
  const placeholderUpsertIndex = source.indexOf("await upsertInBatches(placeholderRows, upsertMatterItems)", linkedImportStart);
  const metadataFetchIndex = source.indexOf("await getOptionalMatterItem(itemId)", linkedImportStart);

  assert.notEqual(sessionImportStart, -1);
  assert.ok(linkedImportIndex > sessionImportStart);
  assert.ok(sessionUpsertIndex > linkedImportIndex);
  assert.ok(placeholderUpsertIndex > linkedImportStart);
  assert.ok(metadataFetchIndex > placeholderUpsertIndex);
});

test("live sync path handles Matter session object mapping and explicit skip reasons", () => {
  const source = readFileSync("lib/matter-sync.ts", "utf8");

  assert.match(source, /extractMatterReadingSessionItemId\(session\)/);
  assert.match(source, /normalizeReadingSession\(session/);
    assert.match(source, /invalid_date/);
  assert.match(source, /invalid_seconds_read/);
  assert.match(source, /database_upsert_error/);
  assert.match(source, /objectSamplePrefix/);
  assert.match(source, /secondsReadType/);
  assert.match(source, /dateType/);
});
