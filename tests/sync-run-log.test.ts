import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeSyncRunErrorMessage } from "../lib/sync-run-log";

test("sanitizes sync run errors before they are displayed", () => {
  const sanitized = sanitizeSyncRunErrorMessage(
    "Matter request failed Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature token=abc123abc123abc123abc123abc123abc123 while fetching page 2"
  );

  assert.equal(sanitized.includes("eyJhbGci"), false);
  assert.equal(sanitized.includes("abc123abc123"), false);
  assert.match(sanitized, /Authorization: \[redacted\]|Authorization: Bearer \[redacted\]/);
  assert.match(sanitized, /fetching page 2/);
});

test("returns a useful placeholder when a failed run has no error text", () => {
  assert.equal(sanitizeSyncRunErrorMessage(null), "No error message recorded.");
});
