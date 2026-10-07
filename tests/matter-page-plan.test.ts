import assert from "node:assert/strict";
import test from "node:test";
import { emptyMatterPagePlan, validateMatterPage, validateMatterPagePlan } from "../lib/matter-page-plan";

test("page envelope rejects missing, divergent and oversized continuation before preparation", () => {
  const page = { object: "list" as const, results: [], has_more: false, next_cursor: null };
  validateMatterPage(page, 25, null);
  for (const bad of [{ ...page, has_more: true }, { ...page, has_more: true, next_cursor: "same" },
    { ...page, next_cursor: "unexpected" }, { ...page, results: Array(26).fill({}) }, { ...page, object: "item" }]) {
    assert.throws(() => validateMatterPage(bad as typeof page, 25, "same"));
  }
});
test("bounded plans reject excess rows and bytes without truncation", () => {
  const plan = emptyMatterPagePlan();
  plan.items = Array(101).fill({ id: "synthetic" });
  assert.throws(() => validateMatterPagePlan(plan));
  plan.items = [{ id: "synthetic", title: "x".repeat(4194304) }];
  assert.throws(() => validateMatterPagePlan(plan));
});
