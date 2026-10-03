import assert from "node:assert/strict";
import test from "node:test";
import { attemptTrackedWrite, cleanupTrackedWrites, verifyLimiterGroups } from "./integration/supabase-security-runner.mjs";

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
