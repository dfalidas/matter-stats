import assert from "node:assert/strict";
import test from "node:test";
import { attemptTrackedWrite, cleanupTrackedWrites, createMatterSyncStreamFixture, createTrackedFixtureWrite, isMigrationSeededStream, restoreMigrationSeed, verifyLimiterGroups } from "./integration/supabase-security-runner.mjs";

test("recognizes only the exact fresh/upgrade migration stream seed", () => {
  const seed = {
    stream: "recent_sessions", endpoint: "/reading_sessions", filters: {}, page_limit: 25,
    cursor: null, cycle_started_at: null, cycle_generation: 0, completed_watermark: null,
    cycle_active: false, transition_status: "legacy_recoverable_restart", coverage_window: "current_year",
  };
  assert.equal(isMigrationSeededStream(seed, "recent_sessions"), true);
  assert.equal(isMigrationSeededStream({ ...seed, completed_watermark: "2026-01-01T00:00:00Z" }, "recent_sessions"), false);
  assert.equal(isMigrationSeededStream({ ...seed, filters: { since: "test-owned" } }, "recent_sessions"), false);
});

test("independently created stream fixtures have unique ownership markers", () => {
  const one = createMatterSyncStreamFixture({ prefix: "security-run-one", timestamp: "2099-01-02T03:04:05.000Z" });
  const two = createMatterSyncStreamFixture({ prefix: "security-run-two", timestamp: "2099-01-02T03:04:05.000Z" });
  assert.notEqual(one.ownership.cursor, two.ownership.cursor);
  assert.equal(one.row.cursor, one.ownership.cursor);
  assert.equal(two.row.cursor, two.ownership.cursor);
});

test("equivalent timestamp serialization does not prevent owned stream cleanup", async () => {
  const fixture = createMatterSyncStreamFixture({ prefix: "security-owned", timestamp: "2099-01-02T03:04:05.000Z" });
  let stored = { ...fixture.row, cycle_started_at: "2099-01-02T03:04:05+00:00" };
  const attempt = createTrackedFixtureWrite(fixture, fixture.row, "owned stream", fixture.selector);
  const failures = await cleanupTrackedWrites([attempt], {
    inspect: async () => ({ data: stored, error: null }),
    remove: async () => { stored = null; return { error: null }; },
  });
  assert.deepEqual(failures, []);
  assert.equal(stored, null);
});

test("committed stream INSERT with a lost response is tracked and cleaned", async () => {
  const fixture = createMatterSyncStreamFixture({ prefix: "security-ambiguous", timestamp: "2099-01-02T03:04:05.000Z" });
  const attempts = [];
  let stored = null;
  const attempt = createTrackedFixtureWrite(fixture, fixture.row, "ambiguous stream", fixture.selector);
  const response = await attemptTrackedWrite(attempts, attempt, async () => {
    stored = { ...fixture.row, cycle_started_at: "2099-01-02T03:04:05+00:00" };
    return { data: null, error: { code: "FETCH_ERROR", message: "response lost" } };
  });
  assert.equal(response.error.code, "FETCH_ERROR");
  const failures = await cleanupTrackedWrites(attempts, {
    inspect: async () => ({ data: stored, error: null }),
    remove: async () => { stored = null; return { error: null }; },
  });
  assert.deepEqual(failures, []);
  assert.equal(stored, null);
});

test("migration seed is restored after a failed fixture run", async () => {
  const seed = {
    stream: "recent_sessions", endpoint: "/reading_sessions", filters: {}, page_limit: 25,
    cursor: null, cycle_started_at: null, cycle_generation: 0, completed_watermark: null,
    cycle_active: false, transition_status: "legacy_recoverable_restart", coverage_window: "current_year",
  };
  const fixture = createMatterSyncStreamFixture({ prefix: "security-failed", timestamp: "2099-01-02T03:04:05.000Z" });
  let stored = { ...fixture.row };
  const attempts = [createTrackedFixtureWrite(fixture, fixture.row, "failed stream", fixture.selector)];
  try {
    throw new Error("controlled verification failure");
  } catch (error) {
    assert.match(error.message, /controlled/);
  } finally {
    assert.deepEqual(await cleanupTrackedWrites(attempts, {
      inspect: async () => ({ data: stored, error: null }),
      remove: async () => { stored = null; return { error: null }; },
    }), []);
    await restoreMigrationSeed(seed, {
      inspect: async () => ({ data: stored, error: null }),
      insert: async (row) => { stored = row; return { error: null }; },
    });
  }
  assert.equal(isMigrationSeededStream(stored, "recent_sessions"), true);
});

test("another run's stream is neither deleted nor overwritten", async () => {
  const fixture = createMatterSyncStreamFixture({ prefix: "security-this-run", timestamp: "2099-01-02T03:04:05.000Z" });
  const other = createMatterSyncStreamFixture({ prefix: "security-other-run", timestamp: "2099-01-02T03:04:05.000Z" });
  let stored = { ...other.row };
  const failures = await cleanupTrackedWrites([
    createTrackedFixtureWrite(fixture, fixture.row, "this run", fixture.selector),
  ], {
    inspect: async () => ({ data: stored, error: null }),
    remove: async () => { stored = null; return { error: null }; },
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /ownership could not be established/);
  assert.equal(stored.cursor, other.ownership.cursor);

  const seed = { stream: "recent_sessions" };
  await assert.rejects(restoreMigrationSeed(seed, {
    inspect: async () => ({ data: stored, error: null }),
    insert: async (row) => { stored = row; return { error: null }; },
  }), /refusing to overwrite/);
  assert.equal(stored.cursor, other.ownership.cursor);
});

const validResponses = () => Array.from({ length: 20 }, (_, index) => Promise.resolve({ data: index < 5, error: null }));

test("ambiguous committed writes are tracked before response validation and cleaned", async () => {
  const rows = new Map();
  const attempts = [];
  const id = "security-run-owned";
  assert.equal(rows.get(id), undefined, "preflight confirms absence");

  const attempt = { label: "matter_items fixture", selector: { id }, owns: (row) => row.id === id };
  const response = await attemptTrackedWrite(attempts, attempt, async () => {
    rows.set(id, { id, title: "owned" });
    return { data: null, error: { code: "FETCH_ERROR", message: "response connection lost" } };
  });
  assert.throws(() => assert.equal(response.error, null), /Expected values to be strictly equal/);

  const failures = await cleanupTrackedWrites(attempts, {
    inspect: async ({ selector }) => ({ data: rows.get(selector.id) ?? null, error: null }),
    remove: async ({ selector }) => { rows.delete(selector.id); return { error: null }; },
  });
  assert.deepEqual(failures, []);
  assert.equal(rows.has(id), false, "finally cleanup removes the ambiguously committed owned row");
});

test("cleanup preserves unrelated resources and continues after an ownership failure", async () => {
  const rows = new Map([
    ["owned", { id: "owned", marker: "this-run" }],
    ["matter", { id: "matter", marker: "another-run" }],
  ]);
  const attempts = [
    { label: "owned fixture", selector: { id: "owned" }, owns: (row) => row.marker === "this-run" },
    { label: "sync_state fixture", selector: { id: "matter" }, owns: (row) => row.marker === "this-run" },
  ];
  const removed = [];
  const failures = await cleanupTrackedWrites(attempts, {
    inspect: async ({ selector }) => ({ data: rows.get(selector.id) ?? null, error: null }),
    remove: async ({ selector }) => { removed.push(selector.id); rows.delete(selector.id); return { error: null }; },
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /ownership could not be established/);
  assert.deepEqual(removed, ["owned"], "a cleanup failure does not stop remaining cleanup");
  assert.deepEqual(rows.get("matter"), { id: "matter", marker: "another-run" }, "unrelated singleton survives");
});

test("limiter orchestration accepts two successful groups", async () => {
  await verifyLimiterGroups(["one", "two"].map((label) => ({
    label,
    requests: validResponses(),
    readStoredCount: async () => ({ count: 5, error: null }),
  })));
});

test("limiter orchestration settles every group before cleanup after a failure", async () => {
  let releasePending;
  const pending = new Promise((resolve) => { releasePending = resolve; });
  let cleanupStarted = false;
  const writes = new Set(["failing"]);
  const first = validResponses();
  first[0] = Promise.reject(new Error("controlled rejection"));
  const second = validResponses();
  second[19] = pending.then((response) => { writes.add("pending"); return response; });

  const run = (async () => {
    try {
      await verifyLimiterGroups([
        { label: "failing", requests: first, readStoredCount: async () => ({ count: 5, error: null }) },
        { label: "pending", requests: second, readStoredCount: async () => ({ count: 5, error: null }) },
      ]);
    } finally {
      cleanupStarted = true;
      writes.clear();
    }
  })();

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cleanupStarted, false, "cleanup must wait for the other group's in-flight write");
  releasePending({ data: false, error: null });
  await assert.rejects(run, /controlled rejection/);
  assert.equal(cleanupStarted, true);
  assert.deepEqual([...writes], [], "no request writes after cleanup has completed");
});

test("limiter orchestration reports response errors, non-booleans, result counts, and persisted counts", async () => {
  const cases = [
    [{ data: null, error: { message: "database failed" } }, /database failed/],
    [{ data: "true", error: null }, /must return a boolean/],
  ];
  for (const [badResponse, expected] of cases) {
    const requests = validResponses();
    requests[0] = Promise.resolve(badResponse);
    await assert.rejects(verifyLimiterGroups([{ label: "bad", requests, readStoredCount: async () => ({ count: 5 }) }]), expected);
  }
  const wrongResults = Array.from({ length: 20 }, (_, index) => Promise.resolve({ data: index < 6, error: null }));
  await assert.rejects(verifyLimiterGroups([{ label: "bad", requests: wrongResults, readStoredCount: async () => ({ count: 5 }) }]), /true exactly five/);
  await assert.rejects(verifyLimiterGroups([{ label: "bad", requests: validResponses(), readStoredCount: async () => ({ count: 4 }) }]), /store exactly five/);
});
