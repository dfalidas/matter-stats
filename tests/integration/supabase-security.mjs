import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { assertGrantDenied, assertSuccessful } from "./supabase-security-assertions.mjs";

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
const authenticated = createClient(url, anonKey, options);
const runId = crypto.randomUUID();
const prefix = `security-${runId}`;
const timestamp = "2099-01-02T03:04:05.000Z";
const updatedTimestamp = "2099-01-03T03:04:05.000Z";
const dateOffset = Number.parseInt(runId.slice(0, 8), 16) % 30000;
const fixtureDate = new Date(Date.UTC(2100, 0, 1 + dateOffset)).toISOString().slice(0, 10);
const hash = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");
const sessionHash = await hash(`${prefix}-session`);
const attemptHash = await hash(`${prefix}-attempt`);

// Explicitly mirrors the columns, constraints, keys, and foreign keys in the
// migration chain. Each browser INSERT uses a distinct valid row.
const fixtures = [
  { table: "matter_items", row: { id: `${prefix}-item`, title: "positive" }, deniedRow: { id: `${prefix}-denied-item`, title: "denied" }, selector: { id: `${prefix}-item` }, update: { title: "updated" }, field: "title", expected: "updated" },
  { table: "reading_sessions", row: { id: `${prefix}-reading`, item_id: `${prefix}-item`, source_device: "positive" }, deniedRow: { id: `${prefix}-denied-reading`, item_id: `${prefix}-item`, source_device: "denied" }, selector: { id: `${prefix}-reading` }, update: { source_device: "updated" }, field: "source_device", expected: "updated" },
  { table: "matter_tags", row: { id: `${prefix}-tag`, name: `${prefix}-positive` }, deniedRow: { id: `${prefix}-denied-tag`, name: `${prefix}-denied` }, selector: { id: `${prefix}-tag` }, update: { name: `${prefix}-updated` }, field: "name", expected: `${prefix}-updated` },
  { table: "item_tags", row: { item_id: `${prefix}-item`, tag_id: `${prefix}-tag`, created_at: timestamp }, deniedRow: { item_id: `${prefix}-item`, tag_id: `${prefix}-tag`, created_at: timestamp }, selector: { item_id: `${prefix}-item`, tag_id: `${prefix}-tag` }, update: { created_at: updatedTimestamp }, field: "created_at", expected: updatedTimestamp, delayedInsert: true },
  { table: "annotations", row: { id: `${prefix}-annotation`, item_id: `${prefix}-item`, note: "positive" }, deniedRow: { id: `${prefix}-denied-annotation`, item_id: `${prefix}-item`, note: "denied" }, selector: { id: `${prefix}-annotation` }, update: { note: "updated" }, field: "note", expected: "updated" },
  { table: "daily_stats", row: { date: fixtureDate, reading_time_seconds: 1, words_read: 1, sessions_count: 1, items_read_count: 1, highlights_count: 1, top_source: "positive" }, deniedRow: { date: new Date(new Date(`${fixtureDate}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10), top_source: "denied" }, selector: { date: fixtureDate }, update: { top_source: "updated" }, field: "top_source", expected: "updated" },
  { table: "sync_runs", row: { id: runId, status: "positive" }, deniedRow: { id: crypto.randomUUID(), status: "denied" }, selector: { id: runId }, update: { status: "updated" }, field: "status", expected: "updated" },
  { table: "sync_state", row: { id: "matter", active_phase: "complete", sync_mode: "recent_activity" }, deniedRow: { id: "matter", active_phase: "complete", sync_mode: "recent_activity" }, selector: { id: "matter" }, update: { active_phase: "items" }, field: "active_phase", expected: "items", delayedInsert: true },
  { table: "app_sessions", row: { token_hash: sessionHash, credential_version: 1, expires_at: "2099-12-31T00:00:00.000Z" }, deniedRow: { token_hash: await hash(`${prefix}-denied-session`), credential_version: 1, expires_at: "2099-12-31T00:00:00.000Z" }, selector: { token_hash: sessionHash }, update: { credential_version: 2 }, field: "credential_version", expected: 2 },
  { table: "app_login_attempts", row: { client_key_hash: attemptHash, attempted_at: timestamp, succeeded: false }, deniedRow: { client_key_hash: await hash(`${prefix}-denied-attempt`), attempted_at: timestamp, succeeded: false }, selector: { client_key_hash: attemptHash }, update: { succeeded: true }, field: "succeeded", expected: true },
];

function filtered(query, selector) {
  return Object.entries(selector).reduce((current, [column, value]) => current.eq(column, value), query);
}

function selectorForRow(fixture, row) {
  if (fixture.table === "item_tags") return { item_id: row.item_id, tag_id: row.tag_id };
  if (fixture.table === "daily_stats") return { date: row.date };
  if (fixture.table === "app_sessions") return { token_hash: row.token_hash };
  if (fixture.table === "app_login_attempts") return { client_key_hash: row.client_key_hash };
  return { id: row.id };
}

const createdFixtures = [];
const attemptedDeniedInserts = [];
const rpcHashes = new Set();
let userId;
const cleanupFailures = [];
async function cleanup(label, action) {
  try {
    const result = await action();
    if (result?.error) throw result.error;
  } catch (error) {
    cleanupFailures.push(`${label}: ${error?.code ?? error?.name ?? "error"} ${error?.message ?? "cleanup failed"}`);
  }
}

try {
  // Refuse collisions instead of overwriting or deleting data not created here.
  for (const fixture of fixtures) {
    const existing = await filtered(service.from(fixture.table).select("*"), fixture.selector).maybeSingle();
    assertSuccessful(existing, `preflight SELECT ${fixture.table}`);
    assert.equal(existing.data, null, `Refusing to overwrite conflicting fixture in ${fixture.table}`);
    const deniedSelector = selectorForRow(fixture, fixture.deniedRow);
    if (JSON.stringify(deniedSelector) !== JSON.stringify(fixture.selector)) {
      const deniedExisting = await filtered(service.from(fixture.table).select("*"), deniedSelector).maybeSingle();
      assertSuccessful(deniedExisting, `preflight denied-INSERT SELECT ${fixture.table}`);
      assert.equal(deniedExisting.data, null, `Refusing to overwrite conflicting denied-INSERT fixture in ${fixture.table}`);
    }
  }

  const email = `stabilization-${runId}@example.invalid`;
  const password = `T-${crypto.randomUUID()}-aA1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  assertSuccessful(created, "create disposable auth user");
  assert.ok(created.data.user, "create disposable auth user returned no user");
  userId = created.data.user.id;
  const signIn = await authenticated.auth.signInWithPassword({ email, password });
  assertSuccessful(signIn, "sign in disposable auth user");
  assert.ok(signIn.data.session, "sign in returned no authenticated session");

  for (const fixture of fixtures) {
    const inserted = await service.from(fixture.table).insert(fixture.row).select("*").single();
    assertSuccessful(inserted, `service_role INSERT ${fixture.table}`);
    createdFixtures.push(fixture);
    const selected = await filtered(service.from(fixture.table).select("*"), fixture.selector).single();
    assertSuccessful(selected, `service_role SELECT ${fixture.table}`);
    const updated = await filtered(service.from(fixture.table).update(fixture.update).select("*"), fixture.selector).single();
    assertSuccessful(updated, `service_role UPDATE ${fixture.table}`);
    const readback = await filtered(service.from(fixture.table).select(fixture.field), fixture.selector).single();
    assertSuccessful(readback, `service_role UPDATE readback ${fixture.table}`);
    const actual = fixture.field.endsWith("_at") ? new Date(readback.data[fixture.field]).toISOString() : readback.data[fixture.field];
    assert.equal(actual, fixture.expected, `service_role UPDATE did not change ${fixture.table}.${fixture.field}`);
  }

  for (const [role, client] of [["anon", anon], ["authenticated", authenticated]]) {
    for (const fixture of fixtures) {
      assertGrantDenied(await filtered(client.from(fixture.table).select("*"), fixture.selector), `${role} SELECT ${fixture.table}`);
      assertGrantDenied(await filtered(client.from(fixture.table).update(fixture.update), fixture.selector), `${role} UPDATE ${fixture.table}`);
      assertGrantDenied(await filtered(client.from(fixture.table).delete(), fixture.selector), `${role} DELETE ${fixture.table}`);
      const unchanged = await filtered(service.from(fixture.table).select(fixture.field), fixture.selector).single();
      assertSuccessful(unchanged, `service_role denied-write readback ${fixture.table}`);
      const actual = fixture.field.endsWith("_at") ? new Date(unchanged.data[fixture.field]).toISOString() : unchanged.data[fixture.field];
      assert.equal(actual, fixture.expected, `${role} write changed ${fixture.table}`);
      if (!fixture.delayedInsert) {
        attemptedDeniedInserts.push({ fixture, selector: selectorForRow(fixture, fixture.deniedRow) });
        assertGrantDenied(await client.from(fixture.table).insert(fixture.deniedRow), `${role} INSERT ${fixture.table}`);
        const deniedInsert = await filtered(service.from(fixture.table).select("*"), selectorForRow(fixture, fixture.deniedRow)).maybeSingle();
        assertSuccessful(deniedInsert, `service_role denied-INSERT readback ${fixture.table}`);
        assert.equal(deniedInsert.data, null, `${role} INSERT persisted in ${fixture.table}`);
      }
    }
    const browserRpcHash = await hash(`${prefix}-${role}-rpc`);
    rpcHashes.add(browserRpcHash);
    const rpc = await client.rpc("record_app_login_attempt", { p_client_key_hash: browserRpcHash, p_succeeded: false, p_limit: 5, p_window_seconds: 900 });
    assertGrantDenied(rpc, `${role} RPC record_app_login_attempt`);
  }

  // Composite/singleton INSERTs cannot use a second equivalent valid key. Delete the
  // positive-control target first, then prove each browser INSERT is grant-denied.
  for (const fixture of fixtures.filter(({ delayedInsert }) => delayedInsert)) {
    const removed = await filtered(service.from(fixture.table).delete().select("*"), fixture.selector).single();
    assertSuccessful(removed, `service_role DELETE ${fixture.table}`);
    createdFixtures.splice(createdFixtures.indexOf(fixture), 1);
    const absent = await filtered(service.from(fixture.table).select("*"), fixture.selector).maybeSingle();
    assertSuccessful(absent, `service_role DELETE readback ${fixture.table}`);
    assert.equal(absent.data, null, `service_role DELETE did not remove ${fixture.table}`);
    for (const [role, client] of [["anon", anon], ["authenticated", authenticated]]) {
      attemptedDeniedInserts.push({ fixture, selector: selectorForRow(fixture, fixture.deniedRow) });
      assertGrantDenied(await client.from(fixture.table).insert(fixture.deniedRow), `${role} INSERT ${fixture.table}`);
    }
  }

  const controlHash = await hash(`${prefix}-rpc-control`);
  rpcHashes.add(controlHash);
  const control = await service.rpc("record_app_login_attempt", { p_client_key_hash: controlHash, p_succeeded: true, p_limit: 5, p_window_seconds: 900 });
  assertSuccessful(control, "service_role RPC control");
  assert.equal(control.data, true, "service_role RPC control was not admitted");
  const controlStored = await service.from("app_login_attempts").select("succeeded").eq("client_key_hash", controlHash).single();
  assertSuccessful(controlStored, "service_role RPC control readback");
  assert.equal(controlStored.data.succeeded, true, "service_role RPC control did not persist its effect");

  const concurrencyHash = await hash(`${prefix}-rpc-concurrency`);
  rpcHashes.add(concurrencyHash);
  const calls = await Promise.all(Array.from({ length: 20 }, () => service.rpc("record_app_login_attempt", {
    p_client_key_hash: concurrencyHash, p_succeeded: false, p_limit: 5, p_window_seconds: 900,
  })));
  for (const [index, call] of calls.entries()) assertSuccessful(call, `concurrency RPC ${index + 1}`);
  assert.equal(calls.filter(({ data }) => data === true).length, 5, "atomic limiter must return true exactly five times");
  assert.equal(calls.filter(({ data }) => data === false).length, 15, "atomic limiter must return false exactly fifteen times");
  const stored = await service.from("app_login_attempts").select("*", { count: "exact", head: true }).eq("client_key_hash", concurrencyHash);
  assertSuccessful(stored, "concurrency RPC stored-count readback");
  assert.equal(stored.count, 5, "atomic limiter must store exactly five attempts");

  // Delete all remaining positive targets in foreign-key-safe reverse order and
  // prove every service-role DELETE affected its target.
  for (const fixture of [...createdFixtures].reverse()) {
    const removed = await filtered(service.from(fixture.table).delete().select("*"), fixture.selector).single();
    assertSuccessful(removed, `service_role DELETE ${fixture.table}`);
    createdFixtures.splice(createdFixtures.indexOf(fixture), 1);
    const absent = await filtered(service.from(fixture.table).select("*"), fixture.selector).maybeSingle();
    assertSuccessful(absent, `service_role DELETE readback ${fixture.table}`);
    assert.equal(absent.data, null, `service_role DELETE did not remove ${fixture.table}`);
  }
  console.log("Disposable Data API grant-denial, service-role control, and atomic concurrency checks passed.");
} finally {
  for (const clientKeyHash of rpcHashes) {
    await cleanup("RPC-generated app_login_attempts", () => service.from("app_login_attempts").delete().eq("client_key_hash", clientKeyHash));
  }
  for (const { fixture, selector } of [...attemptedDeniedInserts].reverse()) {
    await cleanup(`denied INSERT residue ${fixture.table}`, () => filtered(service.from(fixture.table).delete(), selector));
  }
  for (const fixture of [...createdFixtures].reverse()) {
    await cleanup(`fixture ${fixture.table}`, () => filtered(service.from(fixture.table).delete(), fixture.selector));
  }
  if (userId) await cleanup("disposable auth user", () => service.auth.admin.deleteUser(userId));
  if (cleanupFailures.length) {
    throw new AggregateError(cleanupFailures.map((message) => new Error(message)), `Cleanup failed (${cleanupFailures.length} resource(s)); all remaining cleanup was attempted`);
  }
}
