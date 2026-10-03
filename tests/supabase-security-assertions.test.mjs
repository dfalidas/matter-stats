import assert from "node:assert/strict";
import test from "node:test";
import { assertGrantDenied } from "./integration/supabase-security-assertions.mjs";

test("accepts only PostgreSQL grant denial", () => {
  assert.doesNotThrow(() => assertGrantDenied({ error: { code: "42501", message: "permission denied" } }, "SELECT"));
});

for (const [name, result] of [
  ["RLS-filtered success", { data: [], error: null }],
  ["missing column/schema-cache error", { error: { code: "PGRST204", message: "column not found" } }],
  ["invalid payload/constraint error", { error: { code: "23502", message: "not-null violation" } }],
  ["transport error", { error: { code: "FETCH_ERROR", message: "fetch failed" } }],
  ["missing RPC", { error: { code: "PGRST202", message: "function not found" } }],
  ["authentication failure", { error: { code: "PGRST301", message: "invalid JWT" } }],
  ["server error", { error: { code: "XX000", message: "internal error" } }],
]) {
  test(`rejects ${name} as security evidence`, () => {
    assert.throws(() => assertGrantDenied(result, name), /expected grant denial|expected PostgreSQL insufficient_privilege/);
  });
}

test("rejects malformed and missing responses", () => {
  assert.throws(() => assertGrantDenied(undefined, "transport"), /no structured result/);
  assert.throws(() => assertGrantDenied({ error: { message: "network unavailable" } }, "transport"), /unclassified error/);
});
