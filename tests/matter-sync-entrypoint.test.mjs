import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "server-only") return path.join(root, "tests/fixtures/server-only.cjs");
  if (request.startsWith("@/")) return path.join(root, ".test-build", `${request.slice(2)}.js`);
  return originalResolve.call(this, request, parent, isMain, options);
};
const { syncMatterData } = createRequire(import.meta.url)(path.join(root, ".test-build/lib/matter-sync.js"));

const emptyPlan = () => ({ placeholders: [], items: [], sessions: [], tags: [], itemTagIds: [], itemTags: [], annotations: [] });

function stream(name, overrides = {}) {
  return {
    stream: name,
    endpoint: name === "recent_sessions" ? "/reading_sessions" : "/items",
    filters: name === "recent_sessions" ? {} : { status: "all", order: "updated" },
    page_limit: 25, cursor: null, cycle_started_at: null, cycle_generation: 0,
    completed_watermark: null, retry_at: null, cycle_active: false,
    transition_status: "native", coverage_window: name === "recent_sessions" ? "current_year" : null,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function harness({ sessions = [], items = [], now = [], legacyCooldown = null } = {}) {
  const states = new Map([
    ["recent_sessions", stream("recent_sessions")],
    ["library_items", stream("library_items")],
  ]);
  const calls = [];
  const importedSessionIds = new Set();
  let run = 0;
  let generation = 0;
  const deps = {
    acquireLease: async () => ({ accountScope: "matter", owner: crypto.randomUUID(), generation: String(++generation) }),
    renewLease: async () => {},
    releaseLease: async () => true,
    now: () => new Date(now.shift() ?? "2026-06-01T00:00:00.000Z"),
    getStreams: async () => [...states.values()],
    getLegacyState: async () => ({ rate_limited_until: legacyCooldown }),
    getStream: async (name) => states.get(name) ?? null,
    upsertStream: async (value) => {
      const stored = { ...(states.get(value.stream) ?? stream(value.stream)), ...value, updated_at: "2026-01-01T00:00:00.000Z" };
      states.set(value.stream, stored);
      return stored;
    },
    createRun: async (value) => ({ id: `run-${++run}`, ...value }),
    updateRun: async (id, value) => ({ id, items_synced: 0, sessions_synced: 0, annotations_synced: 0, tags_synced: 0, ...value }),
    getAccount: async () => { calls.push("account"); return {}; },
    listSessions: async (params) => { calls.push(["sessions", { ...params }]); const page = sessions.shift(); if (page instanceof Error) throw page; return page; },
    listItems: async (params) => { calls.push(["items", { ...params }]); const page = items.shift(); if (page instanceof Error) throw page; return page; },
    recoverRollups: async () => 0,
    commitPage: async ({ expected, hasMore, nextCursor }) => {
      return deps.upsertStream({ ...expected, cursor: nextCursor, cycle_active: hasMore,
        cycle_started_at: hasMore ? expected.cycle_started_at : null,
        completed_watermark: hasMore ? expected.completed_watermark : expected.cycle_started_at,
        transition_status: hasMore ? expected.transition_status : "native" });
    },
    importSessions: async (page, diagnostics) => {
      for (const result of page.results) {
        importedSessionIds.add(result.id);
        if (!result.item_id) diagnostics.sessionsWithoutLinkedItem += 1;
      }
      return { plan: emptyPlan(), sessions: page.results.length, items: 0, tags: 0, annotations: 0 };
    },
    importItems: async (page) => ({ plan: emptyPlan(), itemCount: page.results.length, tagCount: 0, annotationCount: 0 }),
  };
  return { deps, states, calls, importedSessionIds };
}
const page = (results, next = null) => ({ object: "list", results, has_more: next !== null, next_cursor: next });

test("busy account lease denies all trigger modes before any reads, writes or Matter", async () => {
  for (const mode of ["recent_activity_manual", "recent_activity_scheduled", "backfill_library"]) {
    const touched = [];
    const deps = new Proxy({ acquireLease: async () => null }, {
      get: (target, key) => key in target ? target[key] : async () => { touched.push(key); throw new Error("unexpected work"); },
    });
    const result = await syncMatterData(mode, {}, deps);
    assert.equal(result.skippedReason, "busy");
    assert.deepEqual(touched, []);
  }
});

test("lease infrastructure and invalid context fail closed before Matter or writes", async () => {
  for (const acquireLease of [async () => { throw new Error("RPC unavailable"); }, async () => ({ accountScope: "matter", owner: "bad", generation: "1" })]) {
    const h = harness();
    h.deps.acquireLease = acquireLease;
    assert.equal((await syncMatterData("backfill_library", {}, h.deps)).ok, false);
    assert.deepEqual(h.calls, []);
    assert.equal(h.states.get("library_items").cycle_generation, 0);
  }
});

test("delayed upstream response cannot import or complete after renewal fails", async () => {
  const h = harness();
  const lease = { accountScope: "matter", owner: crypto.randomUUID(), generation: "7" };
  let lost = false;
  let imported = false;
  let released;
  const writeContexts = [];
  h.deps.acquireLease = async () => lease;
  h.deps.renewLease = async (ctx) => { assert.equal(ctx, lease); if (lost) throw new Error("lease lost"); };
  h.deps.releaseLease = async (ctx) => { released = ctx; return false; };
  h.deps.listSessions = async () => { lost = true; return page([{ id: "delayed" }]); };
  h.deps.importSessions = async () => { imported = true; };
  h.deps.updateRun = async (_id, _patch, ctx) => { writeContexts.push(ctx); throw new Error("database fence rejects old lease"); };
  const result = await syncMatterData("recent_activity_scheduled", {}, h.deps);
  assert.equal(result.ok, false);
  assert.equal(imported, false);
  assert.equal(released, lease);
  assert.deepEqual(writeContexts, [lease]);
  assert.equal(h.states.get("recent_sessions").completed_watermark, null);
});

test("exceptions including cancellation compare-release only their invocation context", async () => {
  for (const name of ["Error", "AbortError"]) {
    const h = harness();
    const lease = { accountScope: "matter", owner: crypto.randomUUID(), generation: "3" };
    const released = [];
    h.deps.acquireLease = async () => lease;
    h.deps.getAccount = async () => { throw Object.assign(new Error("cancelled"), { name }); };
    h.deps.releaseLease = async (ctx) => { released.push(ctx); return true; };
    assert.equal((await syncMatterData("backfill_library", {}, h.deps)).ok, false);
    assert.deepEqual(released, [lease]);
  }
});

test("production entrypoint resumes manual → scheduled → manual with pinned contract across New Year", async () => {
  const h = harness({ now: ["2026-12-31T23:59:00Z", "2027-01-01T00:01:00Z", "2027-01-02T00:00:00Z"], sessions: [page([{ id: "a" }], "c2"), page([{ id: "b" }], "c3"), page([], null)] });
  process.env.MATTER_SYNC_SESSIONS_LIMIT = "10";
  await syncMatterData("recent_activity_manual", { recentActivityWindow: "current_year" }, h.deps);
  process.env.MATTER_SYNC_SESSIONS_LIMIT = "99";
  await syncMatterData("recent_activity_scheduled", {}, h.deps);
  await syncMatterData("recent_activity_manual", { recentActivityWindow: "current_year" }, h.deps);
  const requests = h.calls.filter((call) => Array.isArray(call)).map((call) => call[1]);
  assert.deepEqual(requests.map(({ limit }) => limit), [10, 10, 10]);
  assert.deepEqual(requests.map(({ cursor }) => cursor), [undefined, "c2", "c3"]);
  assert.deepEqual(new Set(requests.map(({ since }) => since)), new Set(["2026-01-01T00:00:00.000Z"]));
  assert.equal(h.states.get("recent_sessions").completed_watermark, "2026-12-31T23:59:00.000Z");
});

test("production entrypoint isolates sessions → library → sessions", async () => {
  const h = harness({ sessions: [page([], "session-next"), page([], null)], items: [page([], "item-next")] });
  await syncMatterData("recent_activity_manual", { recentActivityWindow: "current_year" }, h.deps);
  await syncMatterData("backfill_library", {}, h.deps);
  assert.equal(h.states.get("recent_sessions").cursor, "session-next");
  assert.equal(h.states.get("library_items").cursor, "item-next");
  await syncMatterData("recent_activity_scheduled", {}, h.deps);
  assert.equal(h.states.get("library_items").cursor, "item-next");
});

test("cross-stream and legacy account cooldowns make zero upstream calls and preserve state", async () => {
  for (const legacy of [null, "2099-01-01T00:00:00Z"]) {
    const h = harness({ legacyCooldown: legacy, now: ["2026-01-01T00:00:00Z"] });
    if (!legacy) h.states.set("recent_sessions", stream("recent_sessions", { retry_at: "2099-01-01T00:00:00Z", cursor: "keep", cycle_active: true, cycle_started_at: "2025-01-01T00:00:00Z", cycle_generation: 4 }));
    const before = structuredClone([...h.states.entries()]);
    const result = await syncMatterData("backfill_library", {}, h.deps);
    assert.equal(result.ok, false);
    assert.deepEqual(h.calls, []);
    assert.deepEqual([...h.states.entries()], before);
  }
});

test("deliberate window changes are rejected during and after cycles without Matter or state mutation", async () => {
  for (const active of [true, false]) {
    const h = harness();
    h.states.set("recent_sessions", stream("recent_sessions", { cycle_active: active, cycle_started_at: active ? "2026-01-01T00:00:00Z" : null, cursor: active ? "keep" : null, completed_watermark: active ? null : "2026-02-01T00:00:00Z", coverage_window: "current_year" }));
    const before = structuredClone(h.states.get("recent_sessions"));
    const result = await syncMatterData("recent_activity_manual", { recentActivityWindow: "all" }, h.deps);
    assert.equal(result.ok, false);
    assert.match(result.message, /differs/);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.states.get("recent_sessions"), before);
  }
});

test("failure preserves progress; exhausted and empty cycles promote only captured start", async () => {
  const h = harness({ now: ["2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z", "2026-03-03T00:00:00Z"], sessions: [page([], "resume"), new Error("upstream failed"), page([], null)] });
  await syncMatterData("recent_activity_manual", { recentActivityWindow: "current_year" }, h.deps);
  const partial = structuredClone(h.states.get("recent_sessions"));
  const failed = await syncMatterData("recent_activity_scheduled", {}, h.deps);
  assert.equal(failed.ok, false);
  assert.equal(h.states.get("recent_sessions").cursor, partial.cursor);
  assert.equal(h.states.get("recent_sessions").completed_watermark, null);
  await syncMatterData("recent_activity_scheduled", {}, h.deps);
  assert.equal(h.states.get("recent_sessions").completed_watermark, "2026-03-01T00:00:00.000Z");
});

test("inclusive overlap replay is idempotent and imports sessions without item links", async () => {
  const h = harness({ now: ["2026-04-10T00:00:00Z"], sessions: [page([{ id: "same", item_id: null }, { id: "new", item_id: null }], null)] });
  h.states.set("recent_sessions", stream("recent_sessions", { completed_watermark: "2026-04-09T00:00:00.000Z" }));
  h.importedSessionIds.add("same");
  await syncMatterData("recent_activity_scheduled", {}, h.deps);
  assert.equal(h.calls.find((call) => Array.isArray(call))[1].since, "2026-04-02T00:00:00.000Z");
  assert.deepEqual([...h.importedSessionIds].sort(), ["new", "same"]);
  assert.equal(h.importedSessionIds.size, 2);
});

test("invalid continuation is rejected before preparation or page persistence", async () => {
  const h = harness({ sessions: [{ object: "list", results: [{ id: "synthetic" }], has_more: true, next_cursor: null }] });
  let prepared = false; let committed = false;
  h.deps.importSessions = async () => { prepared = true; };
  h.deps.commitPage = async () => { committed = true; };
  assert.equal((await syncMatterData("recent_activity_scheduled", {}, h.deps)).ok, false);
  assert.equal(prepared, false); assert.equal(committed, false);
  assert.equal(h.states.get("recent_sessions").completed_watermark, null);
});
test("rollup failure preserves the committed cursor and later invocation recovers", async () => {
  const h = harness({ sessions: [page([], "next"), page([], null)] });
  let recoverCalls = 0;
  h.deps.recoverRollups = async () => { if (++recoverCalls === 2) throw new Error("synthetic rollup failure"); };
  assert.equal((await syncMatterData("recent_activity_scheduled", {}, h.deps)).ok, false);
  assert.equal(h.states.get("recent_sessions").cursor, "next");
  assert.equal((await syncMatterData("recent_activity_scheduled", {}, h.deps)).ok, true);
  assert.equal(h.states.get("recent_sessions").cycle_active, false);
});
