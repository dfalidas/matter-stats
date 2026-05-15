import assert from "node:assert/strict";
import test from "node:test";

import {
  addMatterBatchCounts,
  buildMatterSyncMessage,
  createEmptyMatterBatchCounts,
  MATTER_SYNC_BATCH_LIMIT,
} from "../lib/matter-sync-progress";

test("uses a conservative Matter batch limit for Vercel-safe sync runs", () => {
  assert.equal(MATTER_SYNC_BATCH_LIMIT, 100);
});

test("builds clear messaging when a bounded batch has more data remaining", () => {
  const message = buildMatterSyncMessage({ items: 100, sessions: 0, annotations: 4, tags: 12 }, true);

  assert.match(message, /Sync started/);
  assert.match(message, /Imported 100 items and 0 sessions/);
  assert.match(message, /More data remains — click Sync again/);
});

test("builds clear messaging when sync completes", () => {
  const message = buildMatterSyncMessage({ items: 0, sessions: 42, annotations: 0, tags: 0 }, false);

  assert.match(message, /Sync complete/);
  assert.match(message, /Imported 0 items and 42 sessions/);
  assert.doesNotMatch(message, /More data remains/);
});

test("adds batch counts without mutating the previous count objects", () => {
  const first = createEmptyMatterBatchCounts();
  const second = { items: 2, sessions: 3, annotations: 5, tags: 7 };
  const combined = addMatterBatchCounts(first, second);

  assert.deepEqual(combined, second);
  assert.deepEqual(first, { items: 0, sessions: 0, annotations: 0, tags: 0 });
});
