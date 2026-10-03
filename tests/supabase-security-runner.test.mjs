import assert from "node:assert/strict";
import test from "node:test";
import { attemptTrackedWrite, cleanupTrackedWrites } from "./integration/supabase-security-runner.mjs";

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
