import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const required = ["STABILIZATION_TEST_SUPABASE_URL", "STABILIZATION_TEST_SUPABASE_ANON_KEY", "STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY"];
if (process.env.DISPOSABLE_DB_ACK !== "yes" || required.some((key) => !process.env[key])) {
  throw new Error(`Refusing to run: set DISPOSABLE_DB_ACK=yes and ${required.join(", ")} for a disposable project.`);
}
const url = process.env.STABILIZATION_TEST_SUPABASE_URL;
const anonKey = process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY;
const serviceKey = process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY;
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const anon = createClient(url, anonKey, options);
const service = createClient(url, serviceKey, options);
const email = `stabilization-${crypto.randomUUID()}@example.invalid`;
const password = `T-${crypto.randomUUID()}-aA1!`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Unable to create disposable auth user");
const authenticated = createClient(url, anonKey, options);
const signIn = await authenticated.auth.signInWithPassword({ email, password });
if (signIn.error) throw signIn.error;

const tables = ["matter_items", "reading_sessions", "matter_tags", "item_tags", "annotations", "daily_stats", "sync_runs", "sync_state", "app_sessions", "app_login_attempts"];
async function assertDenied(client, role) {
  for (const table of tables) {
    for (const [operation, request] of [
      ["SELECT", () => client.from(table).select("*").limit(1)],
      ["INSERT", () => client.from(table).insert({})],
      ["UPDATE", () => client.from(table).update({}).eq("id", "disposable-never")],
      ["DELETE", () => client.from(table).delete().eq("id", "disposable-never")],
    ]) {
      const { error } = await request();
      assert.ok(error, `${role} ${operation} unexpectedly had access to ${table}`);
    }
  }
  const rpc = await client.rpc("record_app_login_attempt", { p_client_key_hash: "0".repeat(64), p_succeeded: false });
  assert.ok(rpc.error, `${role} unexpectedly executed record_app_login_attempt`);
}

try {
  await assertDenied(anon, "anon");
  await assertDenied(authenticated, "authenticated");
  for (const table of tables) {
    const { error } = await service.from(table).select("*").limit(1);
    assert.equal(error, null, `service_role cannot SELECT ${table}: ${error?.message}`);
  }

  const key = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(crypto.randomUUID()));
  const clientHash = [...new Uint8Array(key)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const calls = await Promise.all(Array.from({ length: 20 }, () => service.rpc("record_app_login_attempt", {
    p_client_key_hash: clientHash, p_succeeded: false, p_limit: 5, p_window_seconds: 900,
  })));
  assert.equal(calls.filter(({ data, error }) => !error && data === true).length, 5, "atomic limiter admitted more than five calls");
  const stored = await service.from("app_login_attempts").select("*", { count: "exact", head: true }).eq("client_key_hash", clientHash);
  assert.equal(stored.count, 5, "atomic limiter recorded an unexpected attempt count");
  await service.from("app_login_attempts").delete().eq("client_key_hash", clientHash);
  console.log("Disposable Data API authorization and atomic concurrency checks passed.");
} finally {
  await service.auth.admin.deleteUser(created.data.user.id);
}
