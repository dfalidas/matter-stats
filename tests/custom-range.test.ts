import assert from "node:assert/strict";
import test from "node:test";
import { validateCustomRange } from "../lib/custom-range";

test("custom ranges reject missing and reversed dates instead of falling back", () => {
  assert.deepEqual(validateCustomRange(null, "2026-05-02"), {
    ok: false,
    message: "Choose both a start date and an end date.",
  });
  assert.deepEqual(validateCustomRange("2026-05-03", "2026-05-02"), {
    ok: false,
    message: "The start date must be on or before the end date.",
  });
  assert.deepEqual(validateCustomRange("2026-05-02", "2026-05-02"), {
    ok: true,
    start: "2026-05-02",
    end: "2026-05-02",
  });
});
