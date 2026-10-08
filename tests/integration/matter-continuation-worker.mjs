// A fresh process and fresh production dependencies on EVERY continuation.
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
assert.equal(process.env.DISPOSABLE_DB_ACK, "yes");
const config = JSON.parse(process.argv[2]);
assert.match(config.prefix, /^history-[a-f0-9-]+$/);
assert.ok(["127.0.0.1", "localhost"].includes(new URL(process.env.STABILIZATION_TEST_SUPABASE_URL).hostname));
process.env.SUPABASE_URL = process.env.STABILIZATION_TEST_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY;
process.env.MATTER_API_TOKEN = "synthetic-never-sent";
process.env.APP_TIMEZONE = "Europe/Athens";
process.env.MATTER_SYNC_SESSIONS_LIMIT = String(config.limit ?? 100);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "server-only") return path.join(root, "tests/fixtures/server-only.cjs");
  if (request.startsWith("@/")) return path.join(root, ".test-build", `${request.slice(2)}.js`);
  return originalResolve.call(this, request, parent, isMain, options);
};
const require = createRequire(import.meta.url);
const runtime = require(path.join(root, ".test-build/lib/matter-sync.js"));
const { handleRecentActivityCron } = require(path.join(root, ".test-build/lib/cron-sync.js"));
const originalFetch = globalThis.fetch;
const requests = [];
const databaseEvents = [];
const recordDatabaseEvent = (event) => { databaseEvents.push(event); if (databaseEvents.length>20) databaseEvents.shift(); };
let lostSqlResponses = 0;
let lostBody;
let replayVerified = false;
const page = (results, next = null) => ({ object: "list", results, has_more: next !== null, next_cursor: next });
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== "api.getmatter.com") {
    let response;
    try { response = await originalFetch(input, init); }
    catch (error) {
      recordDatabaseEvent({ endpoint:url.pathname, transportFailure:["AbortError","TimeoutError","TypeError"].includes(error?.name)?error.name:"other" });
      throw error;
    }
    let postgresCode=null, gatewayFailure=null;
    if (!response.ok) {
      const error = await response.clone().json().catch(()=>null);
      if (/^[A-Z0-9]{5}$/.test(error?.code)) postgresCode=error.code;
      // Known public gateway messages only; never copy arbitrary response data.
      for (const known of ["An invalid response was received from the upstream server", "The upstream server is timing out", "The upstream server is not available"]) {
        if (error?.message === known) gatewayFailure=known;
      }
    }
    recordDatabaseEvent({ endpoint:url.pathname,status:response.status,postgresCode, ...(gatewayFailure ? { gatewayFailure } : {}) });
    if (url.pathname.endsWith("/rpc/commit_matter_page")) {
      const payload = JSON.parse(init.body);
      if (lostBody && payload.p_receipt_id === lostBody.p_receipt_id) { assert.deepEqual(payload,lostBody); replayVerified = true; }
      if (config.loseTerminal && lostSqlResponses === 0 && payload.p_expected.stream === "recent_sessions" && !payload.p_has_more) {
        assert.equal(response.ok,true); await response.text(); lostBody = payload; lostSqlResponses++;
        throw new TypeError("synthetic lost durable terminal SQL response");
      }
    }
    return response;
  }
  requests.push({ path: url.pathname, params: Object.fromEntries(url.searchParams) });
  if (url.pathname.endsWith("/me")) return Response.json({object:"account",id:"synthetic-account"});
  if (url.pathname.endsWith("/reading_sessions")) {
    assert.ok([...url.searchParams.keys()].every((key) => ["since", "limit", "cursor"].includes(key)));
    const rows = Array.from({ length: 5000 }, (_, i) => ({ object: "reading_session", id: `${config.prefix}-${i}`,
      date: new Date(Date.UTC(2026, 11, 30, 10) - Math.floor(i / 4) * 86400000).toISOString(), seconds_read: i % 601 }));
    const since = url.searchParams.get("since");
    const matching = since ? rows.filter((row) => row.date >= since) : rows;
    const offset = Number((url.searchParams.get("cursor") ?? "session:0").split(":")[1]);
    const limit = Number(url.searchParams.get("limit"));
    return Response.json(page(matching.slice(offset, offset + limit), offset + limit <= matching.length ? `session:${offset + limit}` : null));
  }
  if (url.pathname.endsWith("/items")) {
    assert.equal(url.searchParams.get("status"), "all"); assert.equal(url.searchParams.get("order"), "updated");
    const offset = Number((url.searchParams.get("cursor") ?? "library:0").split(":")[1]);
    const limit = Number(url.searchParams.get("limit"));
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `${config.prefix}-item-${i}`, object: "item", title: "Synthetic", tags: [] }));
    return Response.json(page(rows.slice(offset, offset + limit), offset + limit < rows.length ? `library:${offset + limit}` : null));
  }
  if (url.pathname.endsWith("/annotations")) return Response.json(page([]));
  throw new Error("Unexpected synthetic endpoint");
};
const deps = { ...runtime.productionSyncDeps, now: () => new Date(config.now) };
let result;
if (config.mode === "cron") {
  const response = await handleRecentActivityCron(new Request("https://synthetic.invalid/api/cron/sync-recent-activity", { headers: { authorization: "Bearer synthetic-cron" } }), {
    cronSecret: "synthetic-cron", syncRecentActivity: () => runtime.syncMatterData("recent_activity_scheduled", {}, deps),
  });
  result = await response.json();
  assert.equal(response.status, 200,JSON.stringify({mode:config.mode,now:config.now,result,databaseEvents}));
} else result = await runtime.syncMatterData(config.mode, {}, deps);
assert.equal(result.ok, true,JSON.stringify({mode:config.mode,now:config.now,result,databaseEvents}));
console.log(JSON.stringify({ result, requests, lostSqlResponses, replayVerified }));
