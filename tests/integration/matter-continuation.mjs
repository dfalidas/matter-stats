import { requestFixture } from "./matter-request-fixture.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { sanitizedEnvironment } from "../../scripts/stabilization-db-orchestrator.mjs";
import { CONTINUATION_FUNCTION_SIGNATURES } from "../../scripts/matter-continuation-inventory.mjs";
import { assertGrantDenied, assertSuccessful } from "./supabase-security-assertions.mjs";

assert.equal(process.env.DISPOSABLE_DB_ACK, "yes");
const project = process.env.STABILIZATION_TEST_SQL_PROJECT;
assert.match(project, /^matter-stats-(fresh|upgrade)-[a-z0-9-]+$/);
const url = process.env.STABILIZATION_TEST_SUPABASE_URL;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const prefix = `history-${crypto.randomUUID()}`;
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY, clientOptions);
const anon = createClient(url, process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY, clientOptions);
const authenticated = createClient(url, process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY, clientOptions);
const sql = (statement) => new Promise((resolve, reject) => {
  const child = spawn("docker", ["--host=unix:///var/run/docker.sock", "exec", "-i", `supabase_db_${project}`, "psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "-"], { env: sanitizedEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stdout.on("data", (chunk) => output += chunk); child.stderr.on("data", (chunk) => errors += chunk);
  child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`Synthetic SQL failed: ${errors}`)));
  child.stdin.end(statement);
});
const rpc = async (name, args) => { const result = await service.rpc(name, args); assertSuccessful(result, name); return result.data; };
const read = async (table) => { const result = await service.from(table).select("*"); assertSuccessful(result, table); return result.data; };
const args = (lease) => ({ p_account_scope: "matter", p_owner: lease.owner, p_generation: lease.generation });
const acquire = async () => { const owner = crypto.randomUUID(); const rows = await rpc("acquire_matter_sync_lease", { p_account_scope: "matter", p_owner: owner, p_ttl_seconds: 120 }); assert.equal(rows.length, 1); return { accountScope: "matter", owner, generation: rows[0].generation }; };
const release = (lease) => rpc("release_matter_sync_lease", args(lease));
const snapshot = () => sql(`select jsonb_build_object('streams',(select jsonb_agg(to_jsonb(s) order by stream) from public.matter_sync_streams s),'intent',(select to_jsonb(c) from public.matter_sync_continuation c),'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by stream),'[]') from public.matter_page_receipts r),'dirty',(select coalesce(jsonb_agg(to_jsonb(d) order by date),'[]') from public.matter_dirty_rollups d),'sessions',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.reading_sessions s where id like '${prefix}%'))::text;`).then(JSON.parse);
const originalResolve = Module._resolveFilename;
const originalFetch = globalThis.fetch;
let requestState;
const checks = [];
const ownedRuns = new Set();
const databaseErrors = [];
let originalStreams, originalIntent, originalDailyStats, initialRuns, authUser, activeLease, ready = false;
let runtime, upstream;
let historyReference;
const page = (results = [], next = null) => ({ object: "list", results, has_more: next !== null, next_cursor: next });
const limits = { pages: 8, requests: 224, upstreamMs: 90000, totalMs: 150000, requestMs: 10000 };
let tick = 0;
const fixtureItem = { id: `${prefix}-expensive`, title: "Synthetic expensive", tags: [] };
async function resetOwnedCycles() {
  await requestState.reset();
  activeLease = await acquire();
  for (const state of originalStreams) await rpc("sync_upsert_stream", { ...args(activeLease), p_state: state });
  assertSuccessful(await service.from("matter_sync_continuation").update(originalIntent).eq("account_scope", "matter"), "restore owned intent fixture");
  await release(activeLease); activeLease = null;
}
async function worker(mode, now, limit = 99, loseTerminal = false) {
  // Distinct synthetic daily invocations: expire only fixture quota reservations.
  // Keep page caches/chains/cursor history; new Task 15 suite checks real policy.
  await requestState.clearQuota();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "tests/integration/matter-continuation-worker.mjs"), JSON.stringify({ prefix, mode, now, limit, loseTerminal })], {
      env: sanitizedEnvironment({ DISPOSABLE_DB_ACK: "yes", STABILIZATION_TEST_SUPABASE_URL: url,
        STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY: process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY }), stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "", errors = "";
    child.stdout.on("data", (chunk) => output += chunk); child.stderr.on("data", (chunk) => errors += chunk);
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(JSON.parse(output.trim().split(/\r?\n/).at(-1))) : reject(new Error(`Synthetic worker failed: ${errors}`)));
  });
}
try {
  requestState=await requestFixture(sql);
  await requestState.reset();
  originalStreams = await read("matter_sync_streams"); originalIntent = (await read("matter_sync_continuation"))[0];
  originalDailyStats = await read("daily_stats");
  initialRuns = new Set((await read("sync_runs")).map((r) => r.id));
  assert.equal(originalIntent.history_status, "none"); assert.equal((await read("matter_sync_leases"))[0].owner, null);
  assert.equal((await read("matter_page_receipts")).length, 0); assert.equal((await read("matter_dirty_rollups")).length, 0);
  ready = true;
  activeLease = await acquire();
  // A completed narrow incremental watermark must not suppress full enumeration.
  await rpc("sync_upsert_stream", { ...args(activeLease), p_state: { ...originalStreams.find((s)=>s.stream === "recent_sessions"), completed_watermark: "2026-12-15T00:00:00Z", coverage_window: "current_year" } });
  const library = originalStreams.find((s) => s.stream === "library_items");
  await rpc("sync_upsert_stream", { ...args(activeLease), p_state: { ...library, cycle_active: true, cycle_started_at: "2026-12-31T20:00:00Z", cycle_generation: library.cycle_generation + 1, page_limit: 2, cursor: "library:0" } });
  await release(activeLease); activeLease = null;
  const allRequests = [], outcomes = [];
  for (let i = 0; i < 12; i++) {
    const report = await worker(i === 0 ? "backfill_sessions" : "cron", i === 0 ? "2026-12-31T23:59:00Z" : `2027-01-${String(i + 1).padStart(2,"0")}T06:00:00Z`, i === 0 ? 100 : 99, true);
    allRequests.push(...report.requests); outcomes.push(report.result);
    const attempts = report.result.requestsAttempted ?? report.result.requests_attempted;
    const committed = report.result.pagesCommitted ?? report.result.pages_committed;
    assert.equal(attempts, report.requests.length); assert.ok(attempts <= 224 && committed <= 8);
    assert.ok(committed > 1, "multiple pages per real production invocation");
    const state = await snapshot();
    if (state.intent.history_status === "complete") { assert.equal(report.lostSqlResponses,1); assert.equal(report.replayVerified,true); break; }
    assert.equal(Date.parse(state.streams.find((s) => s.stream === "recent_sessions").completed_watermark), Date.parse("2026-12-15T00:00:00Z"));
  }
  const complete = await snapshot();
  assert.equal(complete.intent.history_status, "complete"); assert.ok(outcomes.length > 1 && outcomes.length < 12);
  assert.equal(complete.streams.find((s) => s.stream === "library_items").cycle_active, false);
  const sessions = allRequests.filter((r) => r.path.endsWith("/reading_sessions"));
  assert.equal(sessions.length, 51); assert.ok(sessions.every((r) => r.params.limit === "100" && r.params.since === undefined));
  assert.deepEqual(sessions.map((r) => r.params.cursor ?? "session:0"), Array.from({ length: 51 }, (_, i) => `session:${i * 100}`));
  assert.equal(Date.parse(complete.streams.find((s) => s.stream === "recent_sessions").completed_watermark), Date.parse("2026-12-31T23:59:00Z"));
  const reference = JSON.parse(await sql(`with expected as (select '${prefix}-'||i id, timestamptz '2026-12-30T10:00:00Z' - (i/4)*interval '1 day' occurred, i%601 seconds from generate_series(0,4999) i), actual as (select * from public.reading_sessions where id like '${prefix}-%') select jsonb_build_object('count',(select count(*) from actual),'distinct',(select count(distinct id) from actual),'mismatches',(select count(*) from expected e full join actual a on a.id=e.id where a.id is null or e.id is null or a.started_at is distinct from e.occurred or a.duration_seconds is distinct from e.seconds or a.item_id is not null),'duration',(select sum(duration_seconds) from actual),'referenceDuration',(select sum(seconds) from expected))::text;`));
  assert.equal(reference.count, 5000); assert.equal(reference.distinct, 5000); assert.equal(reference.mismatches, 0); assert.equal(reference.duration, reference.referenceDuration);
  historyReference = { ...reference, sessionPages:sessions.length, invocations:outcomes.length };
  const repeated = await worker("backfill_sessions", "2027-02-01T00:00:00Z"); assert.equal(repeated.requests.length, 0); assert.equal(repeated.result.historyStatus, "complete");
  await worker("cron", "2027-02-02T06:00:00Z");
  assert.equal(await sql(`select count(*) from public.reading_sessions where id like '${prefix}-%';`), "5000");
  // Enumeration completion is independent of analytics-ready state. Continue
  // the real durable backlog through bounded cron invocations, with no browser.
  for (let i=0; i<50; i++) {
    const before = Number(await sql("select count(*) from public.matter_dirty_rollups;"));
    if (before===0) break;
    const recovery = await worker("cron","2027-02-03T06:00:00Z");
    const after = Number(await sql("select count(*) from public.matter_dirty_rollups;"));
    assert.ok(before>after && before-after<=64,"cron recovery is bounded and durable after enumeration completion");
    assert.ok(recovery.requests.length<=224);
  }
  assert.equal(await sql("select count(*) from public.matter_dirty_rollups;"),"0");
  checks.push("A/B/C: 5000 documented sessions, ties/multiple years, independent SQL raw reference, 51 exact pages, bounded fresh processes/daily cron, pinned contract/watermark, pending library fairness, completed replay/overlap idempotence and bounded post-exhaustion cron recovery");

  process.env.SUPABASE_URL = url; process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY;
  process.env.MATTER_API_TOKEN = "synthetic-never-sent"; process.env.APP_TIMEZONE = "Europe/Athens";
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === "server-only") return path.join(root,"tests/fixtures/server-only.cjs");
    if (request.startsWith("@/")) return path.join(root,".test-build",`${request.slice(2)}.js`);
    return originalResolve.call(this,request,parent,isMain,options);
  };
  runtime = createRequire(import.meta.url)(path.join(root,".test-build/lib/matter-sync.js"));
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://api.getmatter.com/")) return upstream(new URL(String(input)), init);
    const response = await originalFetch(input, init);
    if (!response.ok) {
      const body = await response.clone().json().catch(()=>null);
      databaseErrors.push({endpoint:new URL(String(input)).pathname,status:response.status,code:/^[A-Z0-9]{5,8}$/.test(body?.code)?body.code:null});
      if (databaseErrors.length>10) databaseErrors.shift();
    }
    return response;
  };
  const deps = { ...runtime.productionSyncDeps, now: () => new Date("2027-03-01T00:00:00Z"), budgetClock: () => tick,
    createRun: async (row, lease) => { const created = await runtime.productionSyncDeps.createRun(row,lease); ownedRuns.add(created.id); return created; } };
  await resetOwnedCycles();
  // Request stops occur in the REAL linked-item and annotation preparation paths.
  for (const stopAt of [2, 3, 5]) {
    tick = 0; const before = await snapshot();
    upstream = (url) => {
      if (url.pathname.endsWith("/me")) return Response.json({object:"account",id:"synthetic-account"});
      if (url.pathname.endsWith("/reading_sessions")) return Response.json(page([{ id: `${prefix}-budget`, item_id: fixtureItem.id, date: "2027-03-01T10:00:00Z", seconds_read: 61 }]));
      if (url.pathname.endsWith("/annotations")) return Response.json(page([], `annotation:${Number((url.searchParams.get("cursor") ?? "annotation:0").split(":")[1]) + 1}`));
      return Response.json(fixtureItem);
    };
    const result = await runtime.syncMatterData("recent_activity_scheduled", { budget: { ...limits, requests: stopAt } }, deps);
    assert.equal(result.status, "partial"); assert.equal(result.pagesCommitted, 0); assert.equal(result.requestsAttempted, stopAt);
    const after = await snapshot(); assert.deepEqual(after.sessions, before.sessions); assert.deepEqual(after.receipts,before.receipts); assert.deepEqual(after.dirty,before.dirty);
    assert.equal(after.streams.find((s) => s.stream === "recent_sessions").cursor, null);
    await resetOwnedCycles();
  }
  for (const endpoint of ["item", "annotations"]) {
    tick = 0;
    upstream = (url) => {
      if (url.pathname.endsWith("/me")) return Response.json({object:"account",id:"synthetic-account"});
      if (url.pathname.endsWith("/reading_sessions")) return Response.json(page([{ id: `${prefix}-budget`, item_id: fixtureItem.id, date: "2027-03-01T10:00:00Z", seconds_read: 61 }]));
      if ((endpoint === "item" && url.pathname.endsWith(fixtureItem.id)) || (endpoint === "annotations" && url.pathname.endsWith("/annotations"))) tick = 90000;
      return Response.json(url.pathname.endsWith("/annotations") ? page() : fixtureItem);
    };
    const result = await runtime.syncMatterData("recent_activity_scheduled", {}, deps);
    assert.equal(result.status,"partial"); assert.equal(result.pagesCommitted,0); await resetOwnedCycles();
  }
  // Fire the actual invocation cancellation timer at a deterministic HTTP
  // barrier. Database calls and shared quota waits retain real timers.
  for (const endpoint of ["item", "annotations"]) {
    tick = 0; const before = await snapshot();
    const originalSetTimeout = globalThis.setTimeout;
    let cancelAttempt;
    globalThis.setTimeout = (callback, delay, ...rest) => {
      const handle = originalSetTimeout(callback, delay, ...rest);
      if (delay === limits.requestMs) cancelAttempt = callback;
      return handle;
    };
    try {
      upstream = (url, init) => {
        if (url.pathname.endsWith("/me")) return Response.json({object:"account",id:"synthetic-account"});
        if (url.pathname.endsWith("/reading_sessions")) return Response.json(page([{ id: `${prefix}-budget`, item_id: fixtureItem.id, date: "2027-03-01T10:00:00Z", seconds_read: 61 }]));
        if ((endpoint === "item" && url.pathname.endsWith(fixtureItem.id)) || (endpoint === "annotations" && url.pathname.endsWith("/annotations"))) {
          assert.equal(typeof cancelAttempt,"function"); assert.equal(init.signal.aborted,false);
          const interrupted = new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once:true }));
          cancelAttempt(); assert.equal(init.signal.aborted,true);
          return interrupted;
        }
        return Response.json(fixtureItem);
      };
      const timedOut = await runtime.syncMatterData("recent_activity_scheduled",{},deps);
      assert.equal(timedOut.ok,false); assert.match(timedOut.message,/exhausted/); assert.equal(timedOut.pagesCommitted,0);
      assert.equal(timedOut.requestsAttempted,endpoint==="item"?5:6);
      const after = await snapshot(); assert.deepEqual(after.sessions,before.sessions); assert.deepEqual(after.receipts,before.receipts); assert.deepEqual(after.dirty,before.dirty);
      assert.equal(after.streams.find((s)=>s.stream==="recent_sessions").cursor,null);
    } finally { globalThis.setTimeout = originalSetTimeout; }
    await resetOwnedCycles();
  }
  // An expensive valid page stops inside preparation, then resumes the stored
  // contract in a fresh invocation without any fixture/cursor reset.
  tick = 0; let annotationCalls = 0; const expensiveParams = [];
  upstream = (url) => {
    if (url.pathname.endsWith("/me")) return Response.json({object:"account",id:"synthetic-account"});
    if (url.pathname.endsWith("/reading_sessions")) { expensiveParams.push(Object.fromEntries(url.searchParams)); return Response.json(page([{ id: `${prefix}-budget`, item_id: fixtureItem.id, date: "2027-03-01T10:00:00Z", seconds_read: 61 }])); }
    if (url.pathname.endsWith("/annotations")) {
      annotationCalls++;
      const ordinal = Number((url.searchParams.get("cursor") ?? "annotation:0").split(":")[1]) + 1;
      return Response.json(page([], ordinal < 100 ? `annotation:${ordinal}` : null));
    }
    return Response.json(fixtureItem);
  };
  const beforeExpensive = await snapshot();
  const pausedExpensive = await runtime.syncMatterData("recent_activity_scheduled", { budget: { ...limits, requests: 5 } }, deps);
  assert.equal(pausedExpensive.status,"partial"); assert.equal(pausedExpensive.pagesCommitted,0); assert.equal(pausedExpensive.requestsAttempted,5); assert.equal(annotationCalls,2);
  const pausedState = await snapshot();
  assert.deepEqual(pausedState.sessions,beforeExpensive.sessions); assert.deepEqual(pausedState.receipts,beforeExpensive.receipts); assert.deepEqual(pausedState.dirty,beforeExpensive.dirty);
  const pausedContract = pausedState.streams.find((s)=>s.stream==="recent_sessions");
  assert.equal(pausedContract.cursor,null); assert.equal(pausedContract.completed_watermark,beforeExpensive.streams.find((s)=>s.stream==="recent_sessions").completed_watermark);
  annotationCalls = 0;
  await requestState.clearQuota();
  const expensive = await runtime.syncMatterData("recent_activity_scheduled", {}, { ...deps, now: () => new Date("2028-01-02T06:00:00Z") });
  assert.equal(expensive.ok,true); assert.equal(expensive.pagesCommitted,1); assert.equal(expensive.requestsAttempted,99); assert.equal(annotationCalls,98);
  assert.equal(expensiveParams.length,1,"cached list is not re-requested");
  const resumedContract = (await snapshot()).streams.find((s)=>s.stream==="recent_sessions");
  assert.equal(resumedContract.cycle_generation,pausedContract.cycle_generation); assert.equal(resumedContract.page_limit,pausedContract.page_limit);
  assert.equal(Date.parse(resumedContract.completed_watermark),Date.parse(pausedContract.cycle_started_at));
  checks.push("D/G: counted me/list/item/all annotation attempts; request/deadline stops and deterministic cancellation timers inside real preparation never commit a subset; fresh reservation completes a valid 100-annotation-page preparation");

  // HTTP failures retain the last committed cursor. 429 in optional paths is
  // account-wide persisted cooldown, including me before list preparation.
  for (const [endpoint,status] of [["me",429],["reading_sessions",500],["reading_sessions",401],["item",429],["annotations",429]]) {
    await resetOwnedCycles(); tick = 0;
    const before = await snapshot();
    upstream = (url) => {
      const target = endpoint === "item" ? url.pathname.endsWith(fixtureItem.id) : url.pathname.endsWith("/"+endpoint);
      if (target) return Response.json({error:{code:"synthetic",message:"synthetic failure"}},{status,headers:status===429?{"retry-after":"60"}:{}});
      if (url.pathname.endsWith("/me")) return Response.json({object:"account",id:"synthetic-account"});
      if (url.pathname.endsWith("/reading_sessions")) return Response.json(page([{id:`${prefix}-budget`,item_id:fixtureItem.id,date:"2027-03-01T10:00:00Z",seconds_read:61}]));
      if (url.pathname.endsWith("/annotations")) return Response.json(page());
      return Response.json(fixtureItem);
    };
    const failed = await runtime.syncMatterData("recent_activity_scheduled",{},deps);
    assert.equal(failed.ok,false); assert.equal(failed.pagesCommitted,0);
    const expectedAttempts = status===500?4:endpoint==="me"?1:endpoint==="item"?3:endpoint==="annotations"?4:2;
    assert.equal(failed.requestsAttempted,expectedAttempts,JSON.stringify({endpoint,status,failed}));
    if (status!==429) assert.match(failed.message,status===500?/exhausted/:new RegExp(`status ${status}`),JSON.stringify({endpoint,status,failed}));
    const after = await snapshot(); assert.deepEqual(after.sessions,before.sessions); assert.deepEqual(after.receipts,before.receipts); assert.deepEqual(after.dirty,before.dirty);
    assert.equal(after.streams.find((s)=>s.stream==="recent_sessions").cursor,null);
    if (status===429) {
      assert.equal(failed.rateLimitedUntil,"2027-03-01T00:01:00.000Z",JSON.stringify({endpoint,status,failed}));
      assert.ok(after.streams.every((s)=>Date.parse(s.retry_at)===Date.parse("2027-03-01T00:01:00Z")),JSON.stringify({endpoint,failed,cooldowns:after.streams.map((s)=>({stream:s.stream,retryAt:s.retry_at})),databaseErrors}));
      let calls=0; upstream=()=>{calls++;throw new Error("cooldown must prevent upstream");};
      assert.equal((await runtime.syncMatterData("recent_activity_scheduled",{},deps)).skippedReason,"rate_limited"); assert.equal(calls,0);
    }
  }
  await resetOwnedCycles(); tick = 0;
  checks.push("E/G: terminal history SQL response lost then exact receipt replay; 500/401 and me/item/annotation 429 stop without incomplete page effects; account cooldown blocks all Matter calls");
  const created = await service.auth.admin.createUser({ email: `${prefix}@example.invalid`, password: `S-${crypto.randomUUID()}-aA1!`, email_confirm:true }); assertSuccessful(created,"synthetic Auth"); authUser = created.data.user.id;
  const password = `S-${crypto.randomUUID()}-aA1!`; assertSuccessful(await service.auth.admin.updateUserById(authUser,{ password }),"synthetic password");
  assertSuccessful(await authenticated.auth.signInWithPassword({ email: created.data.user.email,password }),"browser role session");
  activeLease = await acquire();
  // Exercise the actual PostgREST session, whose preload enforces safeupdate.
  // The managed postgres role cannot LOAD its library directly. This owned,
  // service-only fixture proves the guard rejects an unfiltered no-op UPDATE
  // before invoking the production bounded cooldown in the same transaction.
  const safeupdateFixture = `task14_safeupdate_${crypto.randomUUID().replaceAll("-","")}`;
  await sql(`create function public.${safeupdateFixture}(p_owner uuid,p_generation bigint) returns text language plpgsql volatile security invoker set search_path='' as $control$ begin
    perform public.assert_matter_sync_lease('matter',p_owner,p_generation);
    if current_setting('safeupdate.enabled',true) is distinct from 'on' then raise exception 'service safeupdate guard is not enabled'; end if;
    begin update public.matter_sync_continuation set next_stream=next_stream; raise exception 'safeupdate guard was not enforced'; exception when cardinality_violation then null; end;
    perform public.cooldown_matter_account('matter',p_owner,p_generation,'2027-03-01T00:01:00Z');
    return current_setting('safeupdate.enabled'); end; $control$;
    revoke all on function public.${safeupdateFixture}(uuid,bigint) from public,anon,authenticated;
    grant execute on function public.${safeupdateFixture}(uuid,bigint) to service_role; notify pgrst,'reload schema';`);
  try {
    const controlArgs = { p_owner:activeLease.owner,p_generation:activeLease.generation };
    let control;
    for (let attempt=0; attempt<40; attempt++) {
      control = await service.rpc(safeupdateFixture,controlArgs);
      if (control.error?.code!=="PGRST202") break;
      // Bounded fixture schema discovery only; no application/Matter retries.
      await new Promise((resolve)=>setTimeout(resolve,25));
    }
    assertSuccessful(control,"service-role safeupdate control"); assert.equal(control.data,"on");
    for (const [role,browser] of [["anon",anon],["authenticated",authenticated]]) assertGrantDenied(await browser.rpc(safeupdateFixture,controlArgs),{role,operation:"EXECUTE",kind:"function",name:safeupdateFixture});
  } finally { await sql(`drop function public.${safeupdateFixture}(uuid,bigint); notify pgrst,'reload schema';`); }
  const payloads = {
    cooldown_matter_account: { ...args(activeLease),p_retry_at:"2027-03-01T00:01:00Z" },
    request_matter_history: { ...args(activeLease),p_coverage:"all" },
    begin_matter_history: { ...args(activeLease),p_limit:100,p_started_at:"2027-03-01T00:00:00Z" },
    turn_matter_continuation: { ...args(activeLease),p_stream:"recent_sessions" },
    complete_matter_history: {},
  };
  const beforeDenied = await snapshot();
  for (const [role, client] of [["anon",anon],["authenticated",authenticated]]) {
    for (const [operation, query] of [["SELECT",client.from("matter_sync_continuation").select("*")],["INSERT",client.from("matter_sync_continuation").insert(originalIntent)],["UPDATE",client.from("matter_sync_continuation").update({ next_stream:"recent_sessions" }).eq("account_scope","matter")],["DELETE",client.from("matter_sync_continuation").delete().eq("account_scope","matter")]]) assertGrantDenied(await query,{ role,operation,kind:"table",name:"matter_sync_continuation" });
    for (const signature of CONTINUATION_FUNCTION_SIGNATURES) {
      const name = signature.split("(")[0];
      if (name === "complete_matter_history") {
        // Trigger-returning functions are intentionally absent from PostgREST's
        // RPC cache. Verify the exact grant with the REAL database browser role.
        await sql(`begin; set local role ${role}; do $denial$ begin perform public.complete_matter_history(); raise exception 'unexpected trigger function execution'; exception when insufficient_privilege then if sqlerrm <> 'permission denied for function complete_matter_history' then raise; end if; end; $denial$; rollback;`);
      } else assertGrantDenied(await client.rpc(name,payloads[name]),{role,operation:"EXECUTE",kind:"function",name});
    }
  }
  assert.deepEqual(await snapshot(),beforeDenied);
  assert.equal((await service.rpc("request_matter_history",{ ...args(activeLease),p_coverage:"since=2020" })).error.code,"22023");
  await rpc("request_matter_history",payloads.request_matter_history); const requested = await snapshot();
  await rpc("request_matter_history",payloads.request_matter_history); assert.deepEqual(await snapshot(),requested);
  // Delayed old owner cannot mutate the new history intent, start, scheduling or release.
  assert.equal(await sql(`update public.matter_sync_leases set expires_at=clock_timestamp()-interval '1 second' where owner='${activeLease.owner}' returning owner;`),activeLease.owner);
  const stale = activeLease; activeLease = await acquire(); const beforeStale = await snapshot();
  for (const name of ["request_matter_history","begin_matter_history","turn_matter_continuation","cooldown_matter_account"]) assert.equal((await service.rpc(name,payloads[name])).error.code,"55000");
  assert.equal(await release(stale),false); assert.deepEqual(await snapshot(),beforeStale);
  await release(activeLease); activeLease=null;
  checks.push("F/H: real anon/authenticated CRUD and exact function denials; service controls including safeupdate-enabled cooldown SQL, invalid coverage, idempotent intent, expiry/takeover and stale intent/start/turn/release fences");
} finally {
  globalThis.fetch=originalFetch; Module._resolveFilename=originalResolve;
  if (activeLease) await release(activeLease);
  if (ready) {
    const held=(await read("matter_sync_leases"))[0]; assert.equal(held.owner,null,"refusing cleanup with unknown owner");
    const newRuns=(await read("sync_runs")).filter((r)=>!initialRuns.has(r.id));
    for (const run of newRuns) ownedRuns.add(run.id);
    // Isolated suite owns all post-preflight receipts/dirty dates; no production DB accepted.
    activeLease=await acquire();
    try {
      assertSuccessful(await service.from("matter_sync_continuation").update(originalIntent).eq("account_scope","matter"),"restore intent");
      for (const state of originalStreams) await rpc("sync_upsert_stream",{...args(activeLease),p_state:state});
      assertSuccessful(await service.from("matter_page_receipts").delete().in("stream",["recent_sessions","library_items"]),"receipts cleanup");
      await sql(`delete from public.matter_dirty_rollups where date in (select distinct (started_at at time zone 'Europe/Athens')::date from public.reading_sessions where id like '${prefix}%'); delete from public.daily_stats where date in (select distinct (started_at at time zone 'Europe/Athens')::date from public.reading_sessions where id like '${prefix}%'); delete from public.reading_sessions where id like '${prefix}%'; delete from public.matter_items where id like '${prefix}%';`);
      // Restore aggregates present before the owned fixture, including dates
      // touched by its multi-year sessions. INSERT preserves exact timestamps;
      // an UPSERT would invoke the updated_at trigger on the legacy row.
      const originalDailyJson = JSON.stringify(originalDailyStats).replaceAll("'", "''");
      await sql(`insert into public.daily_stats select restored.* from jsonb_populate_recordset(null::public.daily_stats, '${originalDailyJson}'::jsonb) restored where not exists (select 1 from public.daily_stats current where current.date=restored.date);`);
      if (ownedRuns.size) assertSuccessful(await service.from("sync_runs").delete().in("id",[...ownedRuns]),"owned runs cleanup");
    } finally { await release(activeLease); activeLease=null; }
    assert.deepEqual((await read("matter_sync_continuation"))[0],originalIntent);
    assert.equal(await sql(`select count(*) from public.reading_sessions where id like '${prefix}%';`),"0");
    assert.equal((await read("matter_dirty_rollups")).length,0);
    assert.deepEqual((await read("daily_stats")).sort((a,b)=>a.date.localeCompare(b.date)),originalDailyStats.sort((a,b)=>a.date.localeCompare(b.date)),"exact legacy aggregate restoration");
    if (authUser) assertSuccessful(await service.auth.admin.deleteUser(authUser),"Auth cleanup");
  }
  if (requestState) await requestState.restore();
}
console.log(JSON.stringify({status:"passed",checks,historyReference,realSqlAndDataApi:true,syntheticMatterOnly:true,cleanup:"passed"}));
