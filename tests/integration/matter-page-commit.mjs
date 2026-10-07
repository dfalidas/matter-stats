import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { sanitizedEnvironment } from "../../scripts/stabilization-db-orchestrator.mjs";
import { PAGE_FUNCTION_SIGNATURES, PAGE_TABLES } from "../../scripts/matter-page-inventory.mjs";
import { assertGrantDenied, assertSuccessful } from "./supabase-security-assertions.mjs";

const required = ["STABILIZATION_TEST_SUPABASE_URL", "STABILIZATION_TEST_SUPABASE_ANON_KEY", "STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY", "STABILIZATION_TEST_SQL_PROJECT"];
assert.equal(process.env.DISPOSABLE_DB_ACK, "yes");
assert.ok(required.every((key) => process.env[key]));
const project = process.env.STABILIZATION_TEST_SQL_PROJECT;
assert.match(project, /^matter-stats-(fresh|upgrade)-[a-z0-9-]+$/);
const url = process.env.STABILIZATION_TEST_SUPABASE_URL;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(url, process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY, options);
const authenticated = createClient(url, process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY, options);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const prefix = `page-${crypto.randomUUID()}`;
const sql = (statement) => new Promise((resolve, reject) => {
  const child = spawn("docker", ["--host=unix:///var/run/docker.sock", "exec", "-i", `supabase_db_${project}`, "psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "-"], { env: sanitizedEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
  let output = "", error = "";
  child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { error += data; });
  child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`Disposable SQL: ${error}`)));
  child.stdin.end(statement);
});
const rpc = async (name, payload) => { const result = await service.rpc(name, payload); assertSuccessful(result, name); return result.data; };
const read = async (table) => { const result = await service.from(table).select("*"); assertSuccessful(result, `read ${table}`); return result.data; };
const leaseArgs = (lease) => ({ p_account_scope: "matter", p_owner: lease.owner, p_generation: lease.generation });
const acquire = async () => { const owner = crypto.randomUUID(); const rows = await rpc("acquire_matter_sync_lease", { p_account_scope: "matter", p_owner: owner, p_ttl_seconds: 120 }); assert.equal(rows.length, 1); return { accountScope: "matter", owner, generation: rows[0].generation }; };
const release = (lease) => rpc("release_matter_sync_lease", leaseArgs(lease));
const expire = async (lease) => {
  assert.match(lease.owner, /^[a-f0-9-]{36}$/); assert.match(lease.generation, /^[1-9][0-9]*$/);
  assert.equal(await sql(`update public.matter_sync_leases set expires_at=clock_timestamp()-interval '1 second' where account_scope='matter' and owner='${lease.owner}' and generation=${lease.generation} returning owner;`), lease.owner);
};
const emptyPlan = () => ({ placeholders: [], items: [], sessions: [], tags: [], itemTagIds: [], itemTags: [], annotations: [] });
const expected = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["created_at", "updated_at"].includes(key)));
const page = (results = [], next = null) => ({ object: "list", results, has_more: next !== null, next_cursor: next });
const date = "2300-01-02";
const dates = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2300, 0, i + 1)).toISOString().slice(0, 10));
const item = { object: "item", id: `${prefix}-item`, title: "Synthetic", site_name: "page.example", status: "queue", reading_progress: 0.2, tags: [{ id: `${prefix}-tag`, name: `${prefix}-tag` }] };
const session = { id: `${prefix}-session`, item_id: item.id, date: "2300-01-01T22:30:00Z", seconds_read: 60 };
const annotation = { id: `${prefix}-annotation`, item_id: item.id, text: "Synthetic", created_at: session.date, updated_at: session.date };
const ownedRuns = new Set();
const checks = [];
const originalFetch = globalThis.fetch;
const originalResolve = Module._resolveFilename;
let authUser, originalStreams, ready = false, activeLease;
let runtime, deps;
let upstream = (request) => {
  const p = new URL(request).pathname;
  if (p.endsWith("/me")) return Response.json({ object: "account", id: "synthetic" });
  if (p.endsWith("/reading_sessions")) return Response.json(page([session], "session-next"));
  if (p.endsWith("/annotations")) return Response.json(page([annotation]));
  if (p.endsWith("/items")) return Response.json(page([item], "library-next"));
  if (p.endsWith(`/items/${item.id}`)) return Response.json(item);
  return Response.json({}, { status: 404 });
};
let transport = (request, init) => originalFetch(request, init);
const snapshot = async () => {
  const result = {};
  for (const table of ["matter_items", "matter_tags", "reading_sessions", "annotations", "item_tags", ...PAGE_TABLES, "daily_stats", "matter_sync_streams"]) {
    let rows = await read(table);
    if (["matter_items", "matter_tags", "reading_sessions", "annotations"].includes(table)) rows = rows.filter((r) => r.id.startsWith(prefix));
    if (table === "item_tags") rows = rows.filter((r) => r.item_id.startsWith(prefix));
    if (["daily_stats", "matter_dirty_rollups"].includes(table)) rows = rows.filter((r) => dates.includes(r.date));
    if (table === "matter_sync_streams") rows = rows.map(expected);
    result[table] = rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return result;
};
const commitArgs = async (lease, state, plan, receipt = crypto.randomUUID(), next = "direct-next") => ({
  ...leaseArgs(lease), p_receipt_id: receipt,
  p_previous_receipt_id: (await read("matter_page_receipts")).find((r) => r.stream === state.stream)?.receipt_id ?? null,
  p_expected: expected(state), p_plan: plan, p_has_more: next !== null, p_next_cursor: next, p_timezone: "Europe/Athens",
});
const seedCycle = async (name) => {
  const lease = await acquire();
  try {
    const state = (await read("matter_sync_streams")).find((s) => s.stream === name);
    await rpc("sync_upsert_stream", { ...leaseArgs(lease), p_state: { ...state, cursor: null, cycle_started_at: "2300-02-01T00:00:00Z", cycle_generation: state.cycle_generation + 1, cycle_active: true, retry_at: null } });
  } finally { await release(lease); }
};
const dropTrap = () => sql("drop trigger if exists disposable_page_fail on public.annotations; drop trigger if exists disposable_page_fail on public.reading_sessions; drop trigger if exists disposable_checkpoint_fail on public.matter_sync_streams; drop trigger if exists disposable_rollup_fail on public.daily_stats; drop function if exists public.disposable_page_failure();");
const trap = async (kind) => {
  await dropTrap();
  const table = { rows: "reading_sessions", annotations: "annotations", checkpoint: "matter_sync_streams", rollup: "daily_stats" }[kind];
  const name = { rows: "disposable_page_fail", annotations: "disposable_page_fail", checkpoint: "disposable_checkpoint_fail", rollup: "disposable_rollup_fail" }[kind];
  const condition = kind === "checkpoint" ? "if new.cursor is distinct from old.cursor or (old.cycle_active and not new.cycle_active) then raise exception 'synthetic checkpoint failure'; end if; return new;" : "raise exception 'synthetic write failure';";
  await sql(`create function public.disposable_page_failure() returns trigger language plpgsql security invoker set search_path='' as $$begin ${condition} end;$$; create trigger ${name} after ${kind === "checkpoint" ? "update" : "insert or update"} on public.${table} for each row execute function public.disposable_page_failure();`);
};
try {
  originalStreams = await read("matter_sync_streams");
  assert.equal((await read("matter_sync_leases"))[0].owner, null);
  for (const table of PAGE_TABLES) assert.equal((await read(table)).length, 0, "refusing pending work/receipt collision");
  assert.equal((await snapshot()).daily_stats.length, 0);
  ready = true;
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY;
  process.env.MATTER_API_TOKEN = "synthetic-never-sent-to-Matter";
  process.env.APP_TIMEZONE = "Europe/Athens";
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === "server-only") return path.join(root, "tests/fixtures/server-only.cjs");
    if (request.startsWith("@/")) return path.join(root, ".test-build", `${request.slice(2)}.js`);
    return originalResolve.call(this, request, parent, isMain, options);
  };
  runtime = createRequire(import.meta.url)(path.join(root, ".test-build/lib/matter-sync.js"));
  deps = { ...runtime.productionSyncDeps, now: () => new Date("2300-02-01T00:00:00Z"), createRun: async (row, lease) => { ownedRuns.add(lease.owner); return runtime.productionSyncDeps.createRun(row, lease); } };
  globalThis.fetch = async (request, init) => String(request).startsWith("https://api.getmatter.com/") ? upstream(String(request), init) : transport(request, init);

  // No domain writes during failed preparation, SQL writes or checkpoint update.
  for (const mode of ["recent_activity_scheduled", "backfill_library"]) {
    await seedCycle(mode === "backfill_library" ? "library_items" : "recent_sessions");
    for (const stage of ["continuation", "oversized", "preparation", "annotations", "rows", "checkpoint"]) {
      const normal = upstream;
      if (["continuation", "oversized"].includes(stage)) upstream = (request) => {
        const endpoint = mode === "backfill_library" ? "/items" : "/reading_sessions";
        if (!new URL(request).pathname.endsWith(endpoint)) return normal(request);
        return Response.json(stage === "continuation"
          ? { object: "list", results: [], has_more: true, next_cursor: null }
          : page(Array(101).fill(mode === "backfill_library" ? item : session)));
      };
      else if (stage === "preparation") upstream = (request) => new URL(request).pathname.endsWith("/annotations") ? Promise.reject(new Error("synthetic enrichment failure")) : normal(request);
      else await trap(stage === "rows" && mode === "backfill_library" ? "annotations" : stage);
      const before = await snapshot();
      assert.equal((await runtime.syncMatterData(mode, {}, deps)).ok, false);
      assert.deepEqual(await snapshot(), before, `${mode}/${stage} left partial page effects`);
      upstream = normal; await dropTrap();
    }
  }
  checks.push("Both real import paths: preparation and checkpoint failures roll back all page effects; session SQL failure after item/tag/annotation writes is atomic");

  // Rollup SQL failure happens after the page is durable; dates survive interruption.
  await trap("rollup");
  assert.equal((await runtime.syncMatterData("recent_activity_scheduled", {}, deps)).ok, false);
  let state = await snapshot();
  assert.equal(state.reading_sessions.length, 1); assert.equal(state.item_tags.length, 1);
  assert.equal(state.annotations.length, 1); assert.equal(state.matter_dirty_rollups[0].date, date);
  assert.equal(state.matter_sync_streams.find((s) => s.stream === "recent_sessions").cursor, "session-next");
  await dropTrap();
  const normal = upstream;
  upstream = (request) => new URL(request).pathname.endsWith("/reading_sessions") ? Response.json(page()) : normal(request);
  assert.equal((await runtime.syncMatterData("recent_activity_scheduled", {}, deps)).ok, true);
  state = await snapshot(); assert.equal(state.matter_dirty_rollups.length, 0);
  assert.equal(state.daily_stats.find((r) => r.date === date).words_read, 225);
  assert.equal(Date.parse(state.matter_sync_streams.find((s) => s.stream === "recent_sessions").completed_watermark), Date.parse("2300-02-01T00:00:00Z"));
  upstream = normal;
  checks.push("Rollup persistence failure preserves dirty work and committed cursor; later empty terminal page recovers and completes fixed watermark");

  // Actual HTTP SQL response consumed, then deliberately lost. The client retries
  // the identical body through the Data API and the receipt returns durable state.
  let lost = false; const attempts = [];
  const beforeLibraryUpstream = upstream;
  upstream = (request) => new URL(request).pathname.endsWith("/items")
    ? Response.json(page([{ ...item, site_name: "library.example" }], "library-next")) : beforeLibraryUpstream(request);
  transport = async (request, init) => {
    const result = await originalFetch(request, init);
    if (String(request).endsWith("/rpc/commit_matter_page")) {
      attempts.push(JSON.parse(init.body));
      if (!lost) {
        assert.equal(result.ok, true); await result.text();
        assert.ok((await read("matter_dirty_rollups")).some((r) => r.date === date), "library marker is durable before client acknowledgement");
        assert.equal((await read("matter_sync_streams")).find((r) => r.stream === "library_items").cursor, "library-next");
        assert.equal((await read("matter_page_receipts")).find((r) => r.stream === "library_items").receipt_id, attempts[0].p_receipt_id);
        lost = true; throw new TypeError("synthetic lost acknowledgement");
      }
    }
    return result;
  };
  const sessionsBeforeLibrary = (await snapshot()).matter_sync_streams.find((s) => s.stream === "recent_sessions");
  assert.equal((await runtime.syncMatterData("backfill_library", {}, deps)).ok, true);
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]);
  state = await snapshot(); assert.equal(state.item_tags.length, 1); assert.equal(state.reading_sessions.length, 1);
  assert.deepEqual(state.matter_sync_streams.find((s) => s.stream === "recent_sessions"), sessionsBeforeLibrary);
  transport = (request, init) => originalFetch(request, init);
  checks.push("Library path commits joins/receipt/checkpoint independently; lost real SQL response retries identical receipt without duplicate rows or cursor rewind");

  upstream = beforeLibraryUpstream;
  activeLease = await acquire();
  const stateNow = (await read("matter_sync_streams")).find((s) => s.stream === "library_items");
  const plan = emptyPlan();
  plan.sessions = [];
  plan.items = [{ id: item.id, source: "changed.example", status: "archive", progress: 1 }];
  const first = await commitArgs(activeLease, stateNow, plan);
  await rpc("commit_matter_page", first);
  const marker1 = (await read("matter_dirty_rollups")).find((r) => r.date === date);
  assert.ok(marker1, "metadata change dirties existing local session date");
  const replayBefore = await snapshot(); await rpc("commit_matter_page", first); assert.deepEqual(await snapshot(), replayBefore);
  const nextState = (await read("matter_sync_streams")).find((s) => s.stream === "library_items");
  const changed = emptyPlan(); changed.items = [{ id: item.id, source: "newer.example", status: "queue", progress: 0 }];
  const second = await commitArgs(activeLease, nextState, changed, crypto.randomUUID(), "newer-next");
  await rpc("commit_matter_page", second);
  const marker2 = (await read("matter_dirty_rollups")).find((r) => r.date === date);
  assert.notEqual(marker2.revision, marker1.revision, "multiple pages within SAME lease need different revisions");
  const dailyRow = { date, reading_time_seconds: 60, words_read: 225, sessions_count: 1, items_read_count: 1, highlights_count: 1, top_source: "old.example" };
  assert.equal(await rpc("ack_matter_rollup", { ...leaseArgs(activeLease), p_date: date, p_revision: marker1.revision, p_timezone: marker1.timezone, p_row: dailyRow }), false);
  assert.equal((await read("matter_dirty_rollups")).find((r) => r.date === date).revision, marker2.revision);
  const staleBefore = await snapshot(); assert.equal((await service.rpc("commit_matter_page", first)).error?.code, "40001"); assert.deepEqual(await snapshot(), staleBefore);
  const loopState = (await read("matter_sync_streams")).find((s) => s.stream === "library_items");
  await rpc("commit_matter_page", await commitArgs(activeLease, loopState, emptyPlan(), crypto.randomUUID(), stateNow.cursor));
  const loopBefore = await snapshot();
  assert.equal((await service.rpc("commit_matter_page", first)).error?.code, "40001", "reused opaque cursor must not admit delayed old page");
  assert.deepEqual(await snapshot(), loopBefore);
  checks.push("Exact page replay is read-only; delayed old page rejects; metadata dates dirty; older acknowledgement cannot clear newer same-lease revision");

  // Both old and new dates are computed inside SQL, across Athens local midnight.
  const sessionState = (await read("matter_sync_streams")).find((s) => s.stream === "recent_sessions");
  const activeState = { ...sessionState, cursor: null, cycle_active: true, cycle_started_at: "2300-02-02T00:00:00Z", cycle_generation: sessionState.cycle_generation + 1 };
  await rpc("sync_upsert_stream", { ...leaseArgs(activeLease), p_state: activeState });
  const moved = emptyPlan();
  moved.sessions = [{ id: session.id, item_id: item.id, started_at: "2300-01-02T22:30:00Z", ended_at: "2300-01-02T22:31:00Z", duration_seconds: 60, words_estimated: 225 }];
  moved.annotations = [{ id: annotation.id, item_id: item.id, created_at_matter: "2300-01-03T22:30:00Z", text: "moved" }];
  await rpc("commit_matter_page", await commitArgs(activeLease, activeState, moved));
  const markers = await read("matter_dirty_rollups");
  assert.ok(["2300-01-02", "2300-01-03", "2300-01-04"].every((d) => markers.some((r) => r.date === d)));
  const unchangedState = (await read("matter_sync_streams")).find((s) => s.stream === "recent_sessions");
  const unchangedBefore = await read("matter_dirty_rollups");
  await rpc("commit_matter_page", await commitArgs(activeLease, unchangedState, moved, crypto.randomUUID(), "unchanged-next"));
  assert.deepEqual(await read("matter_dirty_rollups"), unchangedBefore, "unchanged rows must not replace pending revisions");
  checks.push("Updated sessions/annotations dirty old and new APP_TIMEZONE dates across UTC/local boundary; unchanged rows preserve pending revisions");

  // Rejection and fencing leave every row, marker, receipt and transition intact.
  const freshState = (await read("matter_sync_streams")).find((s) => s.stream === "recent_sessions");
  for (const invalid of [
    { ...emptyPlan(), sessions: Array(101).fill({ id: "oversized" }) },
    { ...emptyPlan(), items: [{ id: item.id, secret_column: "disallowed" }] },
    { ...emptyPlan(), items: [{ id: item.id, title: "x".repeat(4194304) }] },
  ]) {
    const before = await snapshot(); assert.equal((await service.rpc("commit_matter_page", await commitArgs(activeLease, freshState, invalid))).error?.code, "22023"); assert.deepEqual(await snapshot(), before);
  }
  const beforeFence = await snapshot();
  await expire(activeLease); const successor = await acquire();
  assert.equal((await service.rpc("commit_matter_page", await commitArgs(activeLease, freshState, emptyPlan()))).error?.code, "55000");
  assert.equal((await service.rpc("ack_matter_rollup", { ...leaseArgs(activeLease), p_date: date, p_revision: marker2.revision, p_timezone: "Europe/Athens", p_row: dailyRow })).error?.code, "55000");
  assert.deepEqual(await snapshot(), beforeFence); await release(successor); activeLease = await acquire();
  checks.push("Oversized/unknown-field payloads reject without writes; expiry/takeover rejects stale page and rollup acknowledgement without changing successor state");

  // Real grants for every new table and exact RPC signature, including helper.
  const created = await service.auth.admin.createUser({ email: `${prefix}@example.invalid`, password: `Aa1!${crypto.randomUUID()}`, email_confirm: true });
  assertSuccessful(created, "Auth fixture"); authUser = created.data.user.id;
  // Use an explicit password for the authenticated client.
  const password = `Aa1!${crypto.randomUUID()}`;
  assertSuccessful(await service.auth.admin.updateUserById(authUser, { password }), "Auth password fixture");
  assertSuccessful(await authenticated.auth.signInWithPassword({ email: `${prefix}@example.invalid`, password }), "sign in fixture");
  const rpcPayloads = {
    validate_matter_page_rows: { p_rows: [], p_kind: "items" },
    commit_matter_page: await commitArgs(activeLease, freshState, emptyPlan()),
    pending_matter_rollups: { ...leaseArgs(activeLease), p_limit: 32 },
    ack_matter_rollup: { ...leaseArgs(activeLease), p_date: date, p_revision: marker2.revision, p_timezone: "Europe/Athens", p_row: dailyRow },
  };
  await rpc("validate_matter_page_rows", rpcPayloads.validate_matter_page_rows);
  await rpc("pending_matter_rollups", rpcPayloads.pending_matter_rollups);
  // Service CRUD controls use recognized synthetic keys; receipts reference a
  // valid existing stream, and are restored only to the fixture-owned row.
  for (const [role, client] of [["anon", anon], ["authenticated", authenticated]]) {
    for (const signature of PAGE_FUNCTION_SIGNATURES) {
      const name = signature.split("(")[0]; assertGrantDenied(await client.rpc(name, rpcPayloads[name]), { role, operation: "EXECUTE", kind: "function", name });
    }
    for (const [table, row, selector] of [["matter_dirty_rollups", { date, revision: crypto.randomUUID(), timezone: "Europe/Athens" }, ["date", date]], ["matter_page_receipts", { stream: "recent_sessions", receipt_id: crypto.randomUUID(), fingerprint: "synthetic" }, ["stream", "recent_sessions"]]]) {
      const operations = [client.from(table).select("*"), client.from(table).insert(row), client.from(table).update(row).eq(...selector), client.from(table).delete().eq(...selector)];
      for (const [i, operation] of operations.entries()) assertGrantDenied(await operation, { role, operation: ["SELECT", "INSERT", "UPDATE", "DELETE"][i], kind: "table", name: table });
    }
  }
  for (const [table, key, value, row, patch] of [
    ["matter_dirty_rollups", "date", date, { date, revision: crypto.randomUUID(), timezone: "Europe/Athens" }, { revision: crypto.randomUUID() }],
    ["matter_page_receipts", "stream", "recent_sessions", { stream: "recent_sessions", receipt_id: crypto.randomUUID(), fingerprint: "synthetic-control" }, { fingerprint: "synthetic-updated" }],
  ]) {
    const saved = (await read(table)).find((r) => r[key] === value);
    assertSuccessful(await service.from(table).delete().eq(key, value), "service delete control");
    assertSuccessful(await service.from(table).insert(row), "service insert control");
    assert.deepEqual((await read(table)).find((r) => r[key] === value), row);
    assertSuccessful(await service.from(table).update(patch).eq(key, value), "service update control");
    assert.deepEqual((await read(table)).find((r) => r[key] === value), { ...row, ...patch });
    assertSuccessful(await service.from(table).delete().eq(key, value), "service final delete control");
    assert.equal((await read(table)).some((r) => r[key] === value), false);
    if (saved) assertSuccessful(await service.from(table).insert(saved), "restore synthetic control");
  }
  checks.push("Real anon/authenticated deny reads/writes and all four exact RPCs; intended service page/marker/helper operations succeed");

  // Bounded work leaves remaining markers. Calculations and acknowledgements are
  // real; interruption before ack retains the exact revision.
  for (const d of dates) assertSuccessful(await service.from("matter_dirty_rollups").upsert({ date: d, revision: crypto.randomUUID(), timezone: "Europe/Athens" }), "bounded marker fixture");
  const pending = await rpc("pending_matter_rollups", { ...leaseArgs(activeLease), p_limit: 32 }); assert.equal(pending.length, 32);
  const pendingBefore = await read("matter_dirty_rollups");
  transport = async (request, init) => {
    if (String(request).endsWith("/rpc/ack_matter_rollup")) throw new TypeError("synthetic interruption before acknowledgement");
    return originalFetch(request, init);
  };
  await assert.rejects(runtime.productionSyncDeps.recoverRollups(activeLease));
  assert.deepEqual(await read("matter_dirty_rollups"), pendingBefore);
  transport = (request, init) => originalFetch(request, init);
  assert.equal(await runtime.productionSyncDeps.recoverRollups(activeLease), 32);
  assert.equal((await read("matter_dirty_rollups")).length, 8);
  assert.equal(await runtime.productionSyncDeps.recoverRollups(activeLease), 8);
  assert.equal((await read("matter_dirty_rollups")).length, 0);
  checks.push("Interrupted acknowledgement retains dirty revision; bounded production recovery processes 32 dates and retains remaining 8 for next call");
  await release(activeLease); activeLease = null;
  await seedCycle("recent_sessions");
  let uncertainResponses = 0;
  transport = async (request, init) => {
    const response = await originalFetch(request, init);
    if (String(request).endsWith("/rpc/commit_matter_page")) {
      assert.equal(response.ok, true); await response.text(); uncertainResponses++;
      throw new TypeError("synthetic both acknowledgements lost");
    }
    return response;
  };
  assert.equal((await runtime.syncMatterData("recent_activity_scheduled", {}, deps)).ok, false);
  assert.equal(uncertainResponses, 2);
  assert.equal((await read("matter_sync_streams")).find((s) => s.stream === "recent_sessions").cursor, "session-next");
  assert.ok((await read("matter_dirty_rollups")).length > 0);
  transport = (request, init) => originalFetch(request, init);
  upstream = (request) => new URL(request).pathname.endsWith("/reading_sessions") ? Response.json(page()) : normal(request);
  assert.equal((await runtime.syncMatterData("recent_activity_scheduled", {}, deps)).ok, true);
  assert.equal((await read("matter_dirty_rollups")).length, 0);
  assert.equal((await read("reading_sessions")).filter((r) => r.id === session.id).length, 1);
  assert.equal((await read("item_tags")).filter((r) => r.item_id === item.id).length, 1);
  checks.push("Both SQL acknowledgements lost: later invocation recovers durable dirty work and resumes committed cursor without duplicate sessions/joins");
  // Embedded metadata, unavailable optional endpoints, required placeholders and
  // per-row skips all pass through the production preparation and commit path.
  const embeddedItem = { ...item, id: `${prefix}-embedded-item`, title: "Embedded" };
  upstream = (request) => {
    const p = new URL(request).pathname;
    if (p.endsWith("/reading_sessions")) return Response.json(page([
      { ...session, id: `${prefix}-embedded-session`, item: embeddedItem, item_id: embeddedItem.id },
      { ...session, id: `${prefix}-placeholder-session`, item_id: `${prefix}-placeholder-item` },
      { ...session, id: `${prefix}-unlinked-session`, item_id: null },
      { ...session, id: "" },
    ]));
    if (p.endsWith(`/items/${prefix}-placeholder-item`)) return Response.json({}, { status: 403 });
    if (p.endsWith("/annotations")) return Response.json({}, { status: 404 });
    return normal(request);
  };
  const preparedRun = await runtime.syncMatterData("recent_activity_scheduled", {}, deps);
  assert.equal(preparedRun.ok, true); assert.equal(preparedRun.sessionsSynced, 3);
  const importedItems = await read("matter_items");
  assert.equal(importedItems.find((r) => r.id === embeddedItem.id).title, "Embedded");
  assert.equal(importedItems.find((r) => r.id === `${prefix}-placeholder-item`).title, "Unknown item");
  assert.equal((await read("reading_sessions")).find((r) => r.id === `${prefix}-unlinked-session`).item_id, null);
  // Optional placeholder does not erase existing enriched item on replay.
  upstream = (request) => new URL(request).pathname.endsWith(`/items/${prefix}-placeholder-item`) ? Response.json({}, { status: 404 }) : upstreamFixture(request);
  const upstreamFixture = (request) => {
    if (new URL(request).pathname.endsWith("/reading_sessions")) return Response.json(page([{ ...session, item_id: embeddedItem.id }]));
    if (new URL(request).pathname.endsWith(`/items/${embeddedItem.id}`)) return Response.json({}, { status: 404 });
    return normal(request);
  };
  assert.equal((await runtime.syncMatterData("recent_activity_scheduled", {}, deps)).ok, true);
  assert.equal((await read("matter_items")).find((r) => r.id === embeddedItem.id).title, "Embedded");
  checks.push("Real embedded items, optional 403/404, insert-only placeholders, unlinked sessions and sanitized per-row skips preserve accepted import contract");

} finally {
  globalThis.fetch = originalFetch; Module._resolveFilename = originalResolve;
  const failures = [];
  const clean = async (fn) => { try { await fn(); } catch (error) { failures.push(error); } };
  await clean(dropTrap);
  if (activeLease) await clean(() => release(activeLease));
  if (ready) await clean(async () => {
    const stored = (await read("matter_sync_leases"))[0];
    if (stored.owner) {
      assert.ok(ownedRuns.has(stored.owner) || stored.owner === activeLease?.owner, "unknown cleanup lease owner");
      await expire({ owner: stored.owner, generation: String(stored.generation) });
    }
    const lease = await acquire();
    try {
      for (const [table, key, values] of [["matter_page_receipts", "stream", ["recent_sessions", "library_items"]], ["matter_dirty_rollups", "date", dates], ["annotations", "id", [annotation.id]], ["reading_sessions", "id", [session.id, `${prefix}-embedded-session`, `${prefix}-placeholder-session`, `${prefix}-unlinked-session`]], ["item_tags", "item_id", [item.id, `${prefix}-embedded-item`]], ["matter_items", "id", [item.id, `${prefix}-embedded-item`, `${prefix}-placeholder-item`]], ["matter_tags", "id", [item.tags[0].id]], ["daily_stats", "date", dates], ["sync_runs", "id", [...ownedRuns]]]) {
        assertSuccessful(await service.from(table).delete().in(key, values), `cleanup ${table}`);
        assert.equal((await service.from(table).select("*").in(key, values)).data.length, 0);
      }
      for (const seed of originalStreams) await rpc("sync_upsert_stream", { ...leaseArgs(lease), p_state: seed });
    } finally { await release(lease); }
  });
  if (authUser) await clean(async () => assertSuccessful(await service.auth.admin.deleteUser(authUser), "Auth cleanup"));
  if (failures.length) throw new AggregateError(failures, "Atomic page fixture cleanup failed");
}
console.log(JSON.stringify({ status: "passed", checks, realSqlAndDataApi: true, syntheticMatterOnly: true, cleanup: "passed" }));
