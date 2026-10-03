import assert from "node:assert/strict";
import test from "node:test";
import { assertGrantDenied } from "./integration/supabase-security-assertions.mjs";

const tableTarget = { role: "anon", operation: "INSERT", kind: "table", name: "matter_items" };
const functionTarget = { role: "authenticated", operation: "EXECUTE", kind: "function", name: "record_app_login_attempt" };

test("accepts a grant denial naming the expected table", () => {
  assert.doesNotThrow(() => assertGrantDenied({
    error: { code: "42501", message: "permission denied for table matter_items", details: null, hint: null },
  }, tableTarget));
});

test("accepts an EXECUTE denial naming the expected function", () => {
  assert.doesNotThrow(() => assertGrantDenied({
    error: { code: "42501", message: "permission denied for function record_app_login_attempt", details: null, hint: null },
  }, functionTarget));
});

for (const [name, result, target] of [
  ["RLS WITH CHECK violation with the same SQLSTATE", { error: { code: "42501", message: "new row violates row-level security policy for table \"matter_items\"" } }, tableTarget],
  ["permission denial for the wrong table", { error: { code: "42501", message: "permission denied for table reading_sessions" } }, tableTarget],
  ["permission denial for a schema", { error: { code: "42501", message: "permission denied for schema public" } }, tableTarget],
  ["permission denial for the wrong function", { error: { code: "42501", message: "permission denied for function unrelated_function" } }, functionTarget],
  ["generic permission error", { error: { code: "42501", message: "permission denied" } }, tableTarget],
  ["RLS-filtered success", { data: [], error: null }, tableTarget],
  ["missing column/schema-cache error", { error: { code: "PGRST204", message: "Could not find the 'missing' column of 'matter_items' in the schema cache" } }, tableTarget],
  ["invalid payload/constraint error", { error: { code: "23502", message: "null value in column \"id\" of relation \"matter_items\" violates not-null constraint" } }, tableTarget],
  ["transport error", { error: { code: "FETCH_ERROR", message: "TypeError: fetch failed" } }, tableTarget],
  ["missing RPC", { error: { code: "PGRST202", message: "Could not find the function public.record_app_login_attempt" } }, functionTarget],
  ["authentication failure", { error: { code: "PGRST301", message: "JWT expired" } }, tableTarget],
  ["server error", { error: { code: "XX000", message: "internal error" } }, tableTarget],
]) {
  test(`rejects ${name} as revoked-grant evidence`, () => {
    assert.throws(() => assertGrantDenied(result, target), /expected grant denial|expected PostgreSQL insufficient_privilege|did not identify/);
  });
}

test("rejects malformed and missing responses", () => {
  assert.throws(() => assertGrantDenied(undefined, tableTarget), /no structured result/);
  assert.throws(() => assertGrantDenied({ error: { message: "network unavailable" } }, tableTarget), /unclassified error/);
});
