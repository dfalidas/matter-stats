import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { sanitizedEnvironment } from "../../scripts/stabilization-db-orchestrator.mjs";
import { LEASE_FUNCTION_SIGNATURES } from "../../scripts/matter-sync-lease-inventory.mjs";
import { assertGrantDenied, assertSuccessful } from "./supabase-security-assertions.mjs";
import { isMigrationSeededStream } from "./supabase-security-runner.mjs";

// Run only as a child of the fresh/upgrade orchestrator. Never read normal app
// credentials, contact Matter, connect to arbitrary SQL hosts, or reset the row.
const keys = ["STABILIZATION_TEST_SUPABASE_URL", "STABILIZATION_TEST_SUPABASE_ANON_KEY", "STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY", "STABILIZATION_TEST_SQL_PROJECT"];
if (process.env.DISPOSABLE_DB_ACK !== "yes" || keys.some((key) => !process.env[key])) throw new Error("Disposable lease runner prerequisites missing");
const project = process.env.STABILIZATION_TEST_SQL_PROJECT;
assert.match(project, /^matter-stats-(fresh|upgrade)-[a-z0-9-]+$/);
const url = process.env.STABILIZATION_TEST_SUPABASE_URL;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "lease tests require orchestrator-local Data API");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(url, process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY, options);
const authenticated = createClient(url, process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY, options);
const prefix = `lease-${crypto.randomUUID()}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const uuid = (value) => { assert.match(value, /^[a-f0-9-]{36}$/); return `'${value}'::uuid`; };
const generation = (value) => { assert.match(String(value), /^[1-9][0-9]*$/); return String(value); };

function sqlProcess() {
  return spawn("docker", ["--host=unix:///var/run/docker.sock", "exec", "-i", `supabase_db_${project}`, "psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "-"], { env: sanitizedEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
}
function sql(statement) {
  return new Promise((resolve, reject) => {
    const child = sqlProcess(); let output = ""; let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`Disposable SQL failed: ${errors.trim()}`)));
    child.stdin.end(statement);
  });
}
const args = (lease) => ({ p_account_scope: "matter", p_owner: lease.owner, p_generation: lease.generation });
async function rpc(name, payload) {
  const result = await service.rpc(name, payload); assertSuccessful(result, name); return result.data;
}
async function acquire(owner = crypto.randomUUID(), ttl = 120) {
  const rows = await rpc("acquire_matter_sync_lease", { p_account_scope: "matter", p_owner: owner, p_ttl_seconds: ttl });
  assert.ok(Array.isArray(rows) && rows.length <= 1);
  return rows.length ? { owner, generation: rows[0].generation } : null;
}
async function expire(lease) {
  const changed = await sql(`update public.matter_sync_leases set expires_at=clock_timestamp()-interval '1 second' where account_scope='matter' and owner=${uuid(lease.owner)} and generation=${generation(lease.generation)} returning owner;`);
  assert.equal(changed, lease.owner, "expiry fixture must own the current lease");
}
const readLease = async () => {
  const result = await service.from("matter_sync_leases").select("*").eq("account_scope", "matter").single();
  assertSuccessful(result, "lease readback"); return result.data;
};
const item = { id: `${prefix}-item`, title: "Synthetic lease item", word_count: 600, source: "lease.example" };
const tag = { id: `${prefix}-tag`, name: `${prefix}-tag` };
const session = { id: `${prefix}-session`, item_id: item.id, started_at: "2200-01-02T10:00:00Z", ended_at: "2200-01-02T10:01:00Z", duration_seconds: 60, words_estimated: 225 };
const annotation = { id: `${prefix}-annotation`, item_id: item.id, text: "Synthetic highlight", created_at_matter: session.started_at };
const daily = { date: "2200-01-02", reading_time_seconds: 60, words_read: 225, sessions_count: 1, items_read_count: 1, highlights_count: 1, top_source: "lease.example" };
const streamState = (name, cursor = null) => ({ stream: name, endpoint: name === "recent_sessions" ? "/reading_sessions" : "/items", filters: name === "recent_sessions" ? { since: "2200-01-01T00:00:00Z" } : { status: "all", order: "updated" }, page_limit: 25, cursor, cycle_started_at: cursor ? "2200-01-02T09:00:00Z" : null, cycle_generation: 1, cycle_active: Boolean(cursor), completed_watermark: null, retry_at: null, transition_status: "native", coverage_window: name === "recent_sessions" ? "all" : null });
const payloads = (lease) => ({
  acquire_matter_sync_lease: { p_account_scope: "matter", p_owner: crypto.randomUUID(), p_ttl_seconds: 120 },
  assert_matter_sync_lease: args(lease),
  renew_matter_sync_lease: { ...args(lease), p_ttl_seconds: 120 },
  release_matter_sync_lease: args(lease),
  validate_matter_sync_batch: { p_rows: [item], p_max_rows: 100 },
  sync_upsert_matter_items: { ...args(lease), p_rows: [item] },
  sync_upsert_matter_tags: { ...args(lease), p_rows: [tag] },
  sync_upsert_reading_sessions: { ...args(lease), p_rows: [session] },
  sync_upsert_annotations: { ...args(lease), p_rows: [annotation] },
  sync_upsert_daily_stats: { ...args(lease), p_rows: [daily] },
  sync_replace_item_tags: { ...args(lease), p_item_ids: [item.id], p_rows: [{ item_id: item.id, tag_id: tag.id }] },
  sync_upsert_stream: { ...args(lease), p_state: streamState("recent_sessions", `${prefix}-cursor`) },
  sync_create_run: { ...args(lease), p_started_at: "2200-01-02T09:00:00Z", p_sync_mode: "recent_activity" },
  sync_update_run: { ...args(lease), p_id: lease.owner, p_patch: { status: "error", error_message: "synthetic" } },
});
async function snapshot() {
  const result = {};
  for (const [table, column, values] of [["matter_items", "id", [item.id, `${prefix}-delayed-item`]], ["reading_sessions", "id", [session.id, `${prefix}-delayed-session`]], ["matter_tags", "id", [tag.id]], ["item_tags", "item_id", [item.id]], ["annotations", "id", [annotation.id]], ["daily_stats", "date", [daily.date]], ["sync_runs", "id", [...ownedRuns]], ["matter_sync_streams", "stream", ["recent_sessions", "library_items"]]]) {
    const read = await service.from(table).select("*").in(column, values).order(column);
    assertSuccessful(read, `snapshot ${table}`); result[table] = read.data;
  }
  return result;
}

const checks = [];
const ownedRuns = new Set();
const leases = [];
let originalStreams;
let authUser;
let runtimeLoaded = false;
let fixturesReady = false;
const originalFetch = globalThis.fetch;
const originalResolve = Module._resolveFilename;
let matterRequests = 0;
let upstream = async (request) => {
  const pathName = new URL(request).pathname;
  if (pathName.endsWith("/me")) return Response.json({ object: "account", id: "synthetic" });
  if (pathName.endsWith("/reading_sessions")) return Response.json({ object: "list", results: [{ id: session.id, item_id: item.id, date: session.started_at, seconds_read: 60 }], has_more: false, next_cursor: null });
  if (pathName.endsWith("/annotations")) return Response.json({ object: "list", results: [annotation], has_more: false, next_cursor: null });
  if (pathName.endsWith(`/items/${item.id}`)) return Response.json({ ...item, object: "item", site_name: "lease.example", tags: [tag] });
  if (pathName.endsWith("/items")) return Response.json({ object: "list", results: [{ ...item, tags: [] }], has_more: false, next_cursor: null });
  throw new Error("Unexpected synthetic Matter endpoint");
};
try {
  const seed = await readLease();
  assert.equal(seed.owner, null, "refusing a live lease fixture collision");
  assert.equal(seed.generation, 0, "runner requires a fresh migration lease seed");
  const saved = await service.from("matter_sync_streams").select("*"); assertSuccessful(saved, "stream seeds");
  assert.equal(saved.data.length, 2);
  assert.ok(saved.data.every((row) => isMigrationSeededStream(row, row.stream)), "refusing non-seed stream fixture collision");
  originalStreams = saved.data;
  for (const [table, key, value] of [["matter_items", "id", item.id], ["matter_tags", "id", tag.id], ["daily_stats", "date", daily.date]]) {
    const preflight = await service.from(table).select("*").eq(key, value); assertSuccessful(preflight, "fixture preflight"); assert.equal(preflight.data.length, 0);
  }
  fixturesReady = true;

  // A: real independent Data API transactions contend for one durable row.
  const contenders = await Promise.all(Array.from({ length: 24 }, () => acquire()));
  assert.equal(contenders.filter(Boolean).length, 1);
  let a = contenders.find(Boolean); leases.push(a); ownedRuns.add(a.owner);
  checks.push("A: 24 concurrent Data API acquisitions admit exactly one owner");
  const p = payloads(a);
  for (const name of ["validate_matter_sync_batch", "assert_matter_sync_lease", "sync_upsert_matter_items", "sync_upsert_matter_tags", "sync_replace_item_tags", "sync_upsert_reading_sessions", "sync_upsert_annotations", "sync_upsert_daily_stats", "sync_upsert_stream", "sync_create_run", "sync_update_run"]) await rpc(name, p[name]);
  assert.equal((await service.from("reading_sessions").select("duration_seconds").eq("id", session.id).single()).data.duration_seconds, 60);

  // G: valid fixtures against every exact helper/RPC and the new table.
  const email = `${prefix}@example.invalid`; const password = `T-${crypto.randomUUID()}-aA1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true }); assertSuccessful(created, "disposable auth creation");
  authUser = created.data.user.id;
  assertSuccessful(await authenticated.auth.signInWithPassword({ email, password }), "authenticated test client");
  for (const [role, client] of [["anon", anon], ["authenticated", authenticated]]) {
    for (const signature of LEASE_FUNCTION_SIGNATURES) {
      const name = signature.split("(")[0];
      assertGrantDenied(await client.rpc(name, p[name]), { role, operation: "EXECUTE", kind: "function", name });
    }
    const operations = [client.from("matter_sync_leases").select("*"), client.from("matter_sync_leases").insert({ account_scope: "matter", owner: crypto.randomUUID(), expires_at: "2200-01-02T10:00:00Z", generation: 1 }), client.from("matter_sync_leases").update({ expires_at: "2200-01-03T00:00:00Z" }).eq("account_scope", "matter"), client.from("matter_sync_leases").delete().eq("account_scope", "matter")];
    for (const [index, operation] of operations.entries()) assertGrantDenied(await operation, { role, operation: ["SELECT", "INSERT", "UPDATE", "DELETE"][index], kind: "table", name: "matter_sync_leases" });
  }
  assertGrantDenied(await service.from("matter_sync_leases").delete().eq("account_scope", "matter"), { role: "service_role", operation: "DELETE", kind: "table", name: "matter_sync_leases" });
  checks.push("G: every lease table/RPC/helper grant denied to both browser roles; service controls succeed");

  // C and D/E: DB time, no sleeps. Application check and actual write are separate.
  assert.equal(await rpc("renew_matter_sync_lease", { ...args(a), p_ttl_seconds: 120 }), true);
  assert.equal(String((await readLease()).generation), a.generation);
  assert.equal(await rpc("renew_matter_sync_lease", { ...args(a), p_owner: crypto.randomUUID(), p_ttl_seconds: 120 }), false);
  assert.equal(await rpc("renew_matter_sync_lease", { ...args(a), p_generation: String(BigInt(a.generation) + BigInt(1)), p_ttl_seconds: 120 }), false);
  for (const ttl of [null, 0, 29, 301]) {
    const result = await service.rpc("acquire_matter_sync_lease", { p_account_scope: "matter", p_owner: crypto.randomUUID(), p_ttl_seconds: ttl }); assert.equal(result.error?.code, "22023");
    assert.equal((await readLease()).owner, a.owner);
  }
  await rpc("assert_matter_sync_lease", args(a)); // Barrier E: check completed.
  await expire(a);
  assert.equal(await rpc("renew_matter_sync_lease", { ...args(a), p_ttl_seconds: 120 }), false);
  let b = await acquire(); assert.ok(b); leases.push(b);
  assert.ok(BigInt(b.generation) > BigInt(a.generation));
  const before = await snapshot();
  for (const name of Object.keys(p).filter((name) => name.startsWith("sync_"))) {
    const result = await service.rpc(name, p[name]); assert.equal(result.error?.code, "55000", `${name} must fence stale worker`);
  }
  for (const state of [streamState("library_items", `${prefix}-stale`), { ...streamState("recent_sessions"), retry_at: "2299-01-01T00:00:00Z" }]) {
    const result = await service.rpc("sync_upsert_stream", { ...args(a), p_state: state }); assert.equal(result.error?.code, "55000");
  }
  assert.equal((await service.rpc("sync_update_run", { ...args(a), p_id: a.owner, p_patch: { status: "success", finished_at: "2200-01-02T11:00:00Z" } })).error?.code, "55000");
  assert.deepEqual(await snapshot(), before);
  assert.equal(await rpc("release_matter_sync_lease", args(a)), false);
  assert.equal(await rpc("renew_matter_sync_lease", { ...args(a), p_ttl_seconds: 120 }), false);
  assert.equal((await readLease()).owner, b.owner);
  assert.equal(await rpc("release_matter_sync_lease", args(b)), true);
  const releasedGeneration = b.generation;
  a = await acquire(); leases.push(a); assert.ok(BigInt(a.generation) > BigInt(releasedGeneration));
  assert.equal(await rpc("release_matter_sync_lease", args(a)), true);
  checks.push("C/D/E/F: renewal, invalid TTL, expiry recovery, every stale write, success/cooldown, and compare-release verified");

  // Separate SQL clients also use the production acquisition RPC under concurrency.
  const sqlOwners = Array.from({ length: 12 }, () => crypto.randomUUID());
  const acquired = await Promise.all(sqlOwners.map((owner) => sql(`set role service_role; select generation from public.acquire_matter_sync_lease('matter',${uuid(owner)},120);`)));
  assert.equal(acquired.filter(Boolean).length, 1);
  a = { owner: sqlOwners[acquired.findIndex(Boolean)], generation: acquired.find(Boolean) }; leases.push(a);
  assert.equal(await rpc("release_matter_sync_lease", args(a)), true);
  checks.push("A SQL: 12 concurrent psql transactions admit one owner");

  // A real RPC write holds the lease lock until its SQL transaction commits.
  // B must wait, even after deterministic fixture expiry, and then see the
  // newer generation. The fixture holds no lock across any Matter request.
  a = await acquire(); leases.push(a);
  const holder = sqlProcess();
  let holderOutput = "";
  let holderErrors = "";
  let markerResolve;
  const marker = new Promise((resolve) => { markerResolve = resolve; });
  const holderClosed = new Promise((resolve, reject) => {
    holder.on("error", reject);
    holder.on("close", (code) => code === 0 ? resolve() : reject(new Error(holderErrors)));
  });
  holder.stderr.on("data", (chunk) => { holderErrors += chunk; });
  holder.stdout.on("data", (chunk) => { holderOutput += chunk; if (holderOutput.includes("LEASE_WRITE_LOCKED")) markerResolve(); });
  let takeover;
  try {
    holder.stdin.write(`begin; set local role service_role; select public.sync_upsert_matter_items('matter',${uuid(a.owner)},${generation(a.generation)},'[{"id":"${item.id}","title":"SQL before takeover"}]'::jsonb); update public.matter_sync_leases set expires_at=clock_timestamp()-interval '1 second' where account_scope='matter';\n\\echo LEASE_WRITE_LOCKED\n`);
    await Promise.race([marker, holderClosed.then(() => { throw new Error("SQL barrier closed early"); }), new Promise((_, reject) => setTimeout(() => reject(new Error("SQL barrier timed out")), 10000))]);
    takeover = acquire();
    const deadline = Date.now() + 10000;
    let blocked = false;
    while (Date.now() < deadline) {
      blocked = Number(await sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%acquire_matter_sync_lease%';")) > 0;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(blocked, true, "takeover must wait for the protected RPC transaction");
  } finally {
    holder.stdin.end("commit;\n");
    await holderClosed;
    if (takeover) { b = await takeover; if (b) leases.push(b); }
  }
  assert.ok(b && BigInt(b.generation) > BigInt(a.generation));
  assert.equal((await service.rpc("sync_upsert_matter_items", { ...args(a), p_rows: [{ id: item.id, title: "stale after commit" }] })).error?.code, "55000");
  assert.equal((await service.from("matter_items").select("title").eq("id", item.id).single()).data.title, "SQL before takeover");
  await rpc("release_matter_sync_lease", args(b));
  checks.push("E SQL: protected RPC transaction serializes takeover through commit");

  // Load the real imports/enrichment/recalculation code. Data API remains real;
  // only Matter HTTP is synthetic. No installed dependencies or auth changes.
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY;
  process.env.MATTER_API_TOKEN = "synthetic-no-upstream-access";
  process.env.APP_TIMEZONE = "UTC";
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === "server-only") return path.join(root, "tests/fixtures/server-only.cjs");
    if (request.startsWith("@/")) return path.join(root, ".test-build", `${request.slice(2)}.js`);
    return originalResolve.call(this, request, parent, isMain, options);
  };
  const { syncMatterData, productionSyncDeps } = createRequire(import.meta.url)(path.join(root, ".test-build/lib/matter-sync.js"));
  runtimeLoaded = true;
  globalThis.fetch = async (request, init) => {
    if (new URL(String(request)).hostname === "api.getmatter.com") { matterRequests += 1; return upstream(String(request), init); }
    return originalFetch(request, init);
  };
  const deps = { ...productionSyncDeps, now: () => new Date("2026-10-05T00:00:00Z") };
  // Count every attempted runtime run ID before the request (lost responses too).
  deps.createRun = async (value, lease) => { ownedRuns.add(lease.owner); return productionSyncDeps.createRun(value, lease); };
  a = await acquire(); leases.push(a);
  const untouched = await snapshot(); const upstreamCount = matterRequests;
  for (const mode of ["recent_activity_manual", "recent_activity_scheduled", "backfill_library"]) {
    assert.equal((await syncMatterData(mode, {}, deps)).skippedReason, "busy");
  }
  assert.equal(matterRequests, upstreamCount); assert.deepEqual(await snapshot(), untouched);
  await rpc("release_matter_sync_lease", args(a));

  // Successful session import calls linked-item lookup, annotation import,
  // item-tag replacement and daily rollup writes on the real runtime path.
  const manualRun = await syncMatterData("recent_activity_manual", {}, deps);
  assert.equal(manualRun.ok, true);
  assert.equal((await service.from("sync_runs").select("sync_mode").eq("id", manualRun.syncRunId).single()).data.sync_mode, "recent_activity");
  assert.equal((await service.from("daily_stats").select("words_read").eq("date", daily.date).single()).data.words_read, 225);
  const sessionCycle = (await snapshot()).matter_sync_streams.find((row) => row.stream === "recent_sessions");
  const libraryRun = await syncMatterData("backfill_library", {}, deps);
  assert.equal(libraryRun.ok, true);
  assert.equal((await service.from("sync_runs").select("sync_mode").eq("id", libraryRun.syncRunId).single()).data.sync_mode, "backfill_library");
  assert.deepEqual((await snapshot()).matter_sync_streams.find((row) => row.stream === "recent_sessions"), sessionCycle);
  assert.equal((await service.from("item_tags").select("*").eq("item_id", item.id)).data.length, 0, "library tags replaced with empty set");
  checks.push("B/H: production trigger exclusion, linked imports/rollup/tag deletion, and independent stream state verified");

  // Delayed Matter responses after takeover: success and 429/catch paths.
  for (const status of [200, 429]) {
    let unblock; let reached;
    const barrier = new Promise((resolve) => { reached = resolve; });
    const pending = new Promise((resolve) => { unblock = resolve; });
    const normalUpstream = upstream;
    upstream = async (request) => {
      if (!new URL(request).pathname.endsWith("/reading_sessions")) return normalUpstream(request);
      reached(); await pending;
      return status === 200 ? Response.json({ object: "list", results: [{ id: `${prefix}-delayed-session`, item_id: `${prefix}-delayed-item`, date: session.started_at, seconds_read: 60 }], has_more: false, next_cursor: null }) : Response.json({ error: { message: "synthetic limit" } }, { status: 429, headers: { "retry-after": "60" } });
    };
    const running = syncMatterData("recent_activity_scheduled", {}, deps);
    let timeoutId;
    try {
      await Promise.race([barrier, running.then(() => { throw new Error("Runtime stopped before Matter barrier"); }), new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error("Matter barrier timed out")), 10000); })]);
    } catch (error) {
      unblock(); await running; throw error;
    } finally { clearTimeout(timeoutId); }
    const contendedState = await snapshot();
    const contendedRequests = matterRequests;
    const rejected = await Promise.all(Array.from({ length: 24 }, (_, index) => syncMatterData(["recent_activity_manual", "recent_activity_scheduled", "backfill_library"][index % 3], {}, deps)));
    assert.ok(rejected.every((result) => result.skippedReason === "busy"));
    assert.equal(matterRequests, contendedRequests);
    assert.deepEqual(await snapshot(), contendedState);
    const stored = await readLease(); a = { owner: stored.owner, generation: String(stored.generation) }; leases.push(a);
    assert.equal((await service.from("sync_runs").select("sync_mode").eq("id", stored.owner).single()).data.sync_mode, "recent_activity");
    await expire(a); b = await acquire(); assert.ok(b); leases.push(b);
    const checkpoint = await snapshot();
    unblock(); assert.equal((await running).ok, false);
    assert.deepEqual(await snapshot(), checkpoint, "delayed response cannot change domain, run completion, stream or cooldown");
    assert.equal((await readLease()).owner, b.owner, "stale finally cannot release B");
    assert.equal(await rpc("release_matter_sync_lease", args(b)), true);
    upstream = normalUpstream;
  }
  const normalUpstream = upstream;
  upstream = async () => { throw Object.assign(new Error("synthetic cancellation"), { name: "AbortError" }); };
  assert.equal((await syncMatterData("backfill_library", {}, deps)).ok, false);
  assert.equal((await readLease()).owner, null, "cancellation releases its valid invocation lease");
  upstream = normalUpstream;
  checks.push("E/F: delayed success and 429 responses after takeover are fenced; cancellation releases own lease");
  console.log(JSON.stringify({ status: "passed", checks, realSqlAndDataApi: true, syntheticMatterOnly: true }));
} finally {
  globalThis.fetch = originalFetch;
  if (runtimeLoaded) Module._resolveFilename = originalResolve;
  const failures = [];
  const cleanup = async (action) => { try { await action(); } catch (error) { failures.push(error); } };
  for (const lease of [...leases].reverse()) await cleanup(() => rpc("release_matter_sync_lease", args(lease)));
  // Expired/crashed fixtures are recovered through acquisition, never DELETE/reset.
  const current = await readLease();
  const ours = current.owner === null || leases.some((lease) => lease.owner === current.owner) || ownedRuns.has(current.owner);
  if (!ours) failures.push(new Error("uncertain lease ownership; refusing cleanup writes"));
  else if (fixturesReady) await cleanup(async () => {
    if (current.owner) await expire({ owner: current.owner, generation: String(current.generation) });
    const cleanupLease = await acquire(); assert.ok(cleanupLease);
    try {
      for (const state of originalStreams ?? []) await rpc("sync_upsert_stream", { ...args(cleanupLease), p_state: state });
      for (const [table, key, values] of [["annotations", "id", [annotation.id]], ["reading_sessions", "id", [session.id, `${prefix}-delayed-session`]], ["item_tags", "item_id", [item.id]], ["matter_items", "id", [item.id, `${prefix}-delayed-item`]], ["matter_tags", "id", [tag.id]], ["daily_stats", "date", [daily.date]], ["sync_runs", "id", [...ownedRuns]]]) assertSuccessful(await service.from(table).delete().in(key, values), `cleanup ${table}`);
    } finally { assert.equal(await rpc("release_matter_sync_lease", args(cleanupLease)), true); }
  });
  if (authUser) await cleanup(async () => assertSuccessful(await service.auth.admin.deleteUser(authUser), "auth cleanup"));
  if (failures.length) throw new AggregateError(failures, "Disposable lease fixture cleanup failed");
}
