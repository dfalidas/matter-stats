import assert from "node:assert/strict";
import test from "node:test";
import { estimateWordsFromSeconds, SESSION_WORD_METHOD } from "../lib/reading-estimates";
import { normalizeReadingSession } from "../lib/matter-normalizers";

test("canonical binary64 operation order and rounding boundaries stay unchanged", () => {
  const expected = [[2,8],[6,23],[130,487],[246,922],[262,982]];
  assert.equal(SESSION_WORD_METHOD,"session-duration-225-round-v1");
  for (const [seconds, words] of expected) {
    assert.equal(estimateWordsFromSeconds(seconds),words);
    assert.equal(normalizeReadingSession({id:`synthetic-${seconds}`,date:"2026-12-30T10:00:00Z",seconds_read:seconds})?.words_estimated,words);
  }
  // Reordering to seconds * 225 / 60 or seconds * 3.75 changes this result.
  assert.equal(Math.round(130 * 225 / 60),488);
  assert.equal(Math.round(130 / 60 * 225),487);
});
