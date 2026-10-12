import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".test-build");
const require = Module.createRequire(import.meta.url);
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
let client;
// Same isolated CommonJS boundary technique as auth-entrypoints.test.mjs.
// Stub only admin-client creation; execute the real daily-stat service/query.
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith("@/")) request = path.join(root, request.slice(2)) + ".js";
  return originalResolve.call(this, request, parent, ...rest);
};
Module._load = function(request, parent, ...rest) {
  if (request === "./supabase-admin" && parent?.filename === path.join(root, "lib/daily-stats.js")) return { getSupabaseAdminClient: () => client };
  if (request === "./matter-sync-lease" && parent?.filename === path.join(root, "lib/daily-stats.js")) return {};
  return originalLoad.call(this, request, parent, ...rest);
};
const { calculateDailyStat } = require(path.join(root, "lib/daily-stats.js"));
const { getArticleDetail } = require(path.join(root, "lib/articles-service.js"));
const { cappedPostgrest } = require(path.join(root, "tests/fixtures/capped-postgrest.js"));
Module._load = originalLoad;
Module._resolveFilename = originalResolve;

const item = { id: "item", title: "Synthetic", source: "Source", status: "archive", word_count: 999999, progress: 1 };
function rows(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `s-${String(index).padStart(6, "0")}`, item_id: "item", started_at: "2026-09-10T10:00:00Z", duration_seconds: 60, words_estimated: 999999, matter_items: item }));
}

test("daily-stat calculation reads all 1,200 sessions under cap 100 with local half-open boundaries", async () => {
  const data = rows(1200);
  data.push({ ...data[0], id: "outside", started_at: "2026-09-10T21:00:00Z" });
  const fixture = cappedPostgrest({ reading_sessions: data }, { cap: 100 });
  client = fixture.client;
  const daily = await calculateDailyStat("2026-09-10", "Europe/Athens");
  assert.equal(daily.sessions_count, 1200);
  assert.equal(daily.reading_time_seconds, 72000);
  assert.equal(daily.words_read, 270000);
  assert.equal(daily.items_read_count, 1);
  assert.equal(daily.top_source, "Source");
  assert.ok(fixture.requests.some((r) => r.url.searchParams.get("started_at") === "gte.2026-09-09T21:00:00.000Z"));
  assert.ok(fixture.requests.some((r) => r.url.searchParams.getAll("started_at").includes("lt.2026-09-10T21:00:00.000Z")));
});

test("article source comparison is complete while the 25-session preview stays bounded; null keys retained", async () => {
  const data = rows(1200);
  for (const row of data.slice(1000)) row.started_at = null;
  const fixture = cappedPostgrest({ reading_sessions: data, matter_items: [item] }, { cap: 100 });
  const detail = await getArticleDetail(fixture.client, "item");
  assert.equal(detail.sessions.length, 25);
  assert.equal(detail.sourcePerformance.articleTimeSeconds, 72000);
  assert.equal(detail.sourcePerformance.sourceAverageTimeSeconds, 72000);
  assert.equal(detail.sourcePerformance.sourceArticleCount, 1);
  const complete = fixture.requests.filter((r) => r.table === "reading_sessions" && r.url.searchParams.get("limit") === "500");
  const ids = complete.flatMap((r) => r.ids);
  assert.deepEqual([...ids].sort(), data.map((r) => r.id).sort());
  assert.equal(new Set(ids).size, 1200);
  assert.ok(complete.some((r) => r.url.searchParams.get("or").includes("started_at.is.null,id.gt")));
  assert.equal(fixture.requests.filter((r) => r.table === "reading_sessions" && r.url.searchParams.get("limit") === "25").length, 1);
});

test("daily-stat calculation propagates a later database error without a partial rollup", async () => {
  const fixture = cappedPostgrest({ reading_sessions: rows(1200) }, { cap: 100, respond: (request) => {
    if (request.table === "reading_sessions" && request.number === 3) return Response.json({ message: "synthetic failure", code: "XX000" }, { status: 500 });
  } });
  client = fixture.client;
  await assert.rejects(calculateDailyStat("2026-09-10"), (error) => error.message === "synthetic failure");
});

test("nullable-key traversal pins dated and null boundaries against concurrent appends", async () => {
  const data = rows(250);
  for (const row of data.slice(200)) row.started_at = null;
  const fixture = cappedPostgrest({ reading_sessions: data, matter_items: [item] }, { cap: 100, before: (request) => {
    if (request.table === "reading_sessions" && request.url.searchParams.get("limit") === "500" && !data.some((r) => r.id === "z-new-null")) {
      data.push({ ...data[0], id: "z-new-dated", started_at: "2026-09-10T11:00:00Z" });
      data.push({ ...data[0], id: "z-new-null", started_at: null });
    }
  } });
  const detail = await getArticleDetail(fixture.client, "item");
  assert.equal(detail.sourcePerformance.articleTimeSeconds, 15000);
  const ids = fixture.requests.filter((r) => r.table === "reading_sessions" && r.url.searchParams.get("limit") === "500").flatMap((r) => r.ids);
  assert.deepEqual([...ids].sort(), rows(250).map((r) => r.id));
});
