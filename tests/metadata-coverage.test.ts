import test from "node:test";
import assert from "node:assert/strict";

import { SESSION_METADATA_EMPTY_STATE, hasSessionMetadataCoverage } from "../lib/metadata-coverage";

test("uses stable empty-state copy for missing session metadata", () => {
  assert.equal(SESSION_METADATA_EMPTY_STATE, "Session-to-item attribution is unsupported without a documented item identifier. Another metadata sync is not guaranteed to resolve it.");
});

test("detects missing metadata coverage when top rankings are empty", () => {
  assert.equal(hasSessionMetadataCoverage({ topSources: [], topAuthors: [], topTags: [] }), false);
});

test("detects metadata coverage when any ranking has data", () => {
  assert.equal(hasSessionMetadataCoverage({ topSources: [{ name: "A", readingTimeSeconds: 1, wordsRead: 1, articlesRead: 1, sessionsCount: 1 }], topAuthors: [], topTags: [] }), true);
});
