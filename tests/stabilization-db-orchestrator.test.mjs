import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertDisposableDirectory, assertLegacyPreserved, parseStatusEnv, removeOwnedLegacySingleton, runStabilizationDatabases, sanitizedEnvironment, SUPABASE_CLI_VERSION } from "../scripts/stabilization-db-orchestrator.mjs";

test("runner pins tooling, parses local status, and strips application secrets from children", () => {
  assert.match(SUPABASE_CLI_VERSION, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(parseStatusEnv('API_URL="http://127.0.0.1:54321"\nANON_KEY="anon"\n'), { API_URL: "http://127.0.0.1:54321", ANON_KEY: "anon" });
  const env = sanitizedEnvironment({ DISPOSABLE_DB_ACK: "yes" });
  assert.equal(env.DISPOSABLE_DB_ACK, "yes");
  assert.equal(env.MATTER_API_TOKEN, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
});

test("runner refuses cleanup targets outside the OS temporary directory", () => {
  assert.throws(() => assertDisposableDirectory(process.cwd()), /temporary directory/);
  assert.doesNotThrow(() => assertDisposableDirectory(path.join(os.tmpdir(), "owned-disposable")));
});

test("Docker-unavailable path writes honest sanitized blocked evidence without provisioning", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "blocked-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.DISPOSABLE_DB_ACK;
  process.env.DISPOSABLE_DB_ACK = "yes";
  t.after(() => { if (previous === undefined) delete process.env.DISPOSABLE_DB_ACK; else process.env.DISPOSABLE_DB_ACK = previous; });
  const result = await runStabilizationDatabases({ evidenceRoot: root, hasDocker: () => false, getIdentity: () => ({testedSha:"a".repeat(40),event:"unit-test"}) });
  assert.equal(result.status, "blocked");
  assert.equal(result.realDatabaseVerification, false);
  const stored = JSON.parse(await readFile(path.join(root, result.gitSha, "blocked.json"), "utf8"));
  assert.deepEqual(stored, result);
  assert.deepEqual(Object.keys(stored).sort(), ["gitSha", "realDatabaseVerification", "reason", "status"]);
});

test("owned preserved singleton is removed and confirmed absent before integration", async () => {
  const events = [];
  const responses = ["task05-owned\n", "matter\n", "0\n"];
  await removeOwnedLegacySingleton({
    ownershipMarker: "task05-owned",
    query: async (sql) => { events.push(sql.startsWith("select count") ? "absence" : sql.startsWith("delete") ? "delete" : "ownership"); return responses.shift(); },
    runIntegration: () => { events.push("integration"); },
  });
  assert.deepEqual(events, ["ownership", "delete", "absence", "integration"]);
});

test("unrelated singleton is preserved and prevents integration", async () => {
  let integrationRan = false;
  let calls = 0;
  await assert.rejects(removeOwnedLegacySingleton({
    ownershipMarker: "task05-owned",
    query: async () => { calls += 1; return "unrelated-marker\n"; },
    runIntegration: () => { integrationRan = true; },
  }), /ownership is unexpected/);
  assert.equal(calls, 1, "uncertain ownership prevents the DELETE statement");
  assert.equal(integrationRan, false);
});

test("failed singleton removal or absence readback prevents integration", async () => {
  for (const responses of [["task05-owned\n", "\n"], ["task05-owned\n", "matter\n", "1\n"]]) {
    let integrationRan = false;
    await assert.rejects(removeOwnedLegacySingleton({
      ownershipMarker: "task05-owned",
      query: async () => responses.shift(),
      runIntegration: () => { integrationRan = true; },
    }), /not removed|remains/);
    assert.equal(integrationRan, false);
  }
});

test("complete legacy snapshot comparison detects tag, run, and session changes", () => {
  const snapshot = {
    matter_items: [{ id: "item", title: "title" }],
    reading_sessions: [{ id: "session", item_id: "item", duration_seconds: 754 }],
    matter_tags: [{ id: "tag", name: "Legacy tag" }],
    item_tags: [{ item_id: "item", tag_id: "tag" }],
    annotations: [{ id: "annotation", item_id: "item", note: "note" }],
    daily_stats: [{ date: "2026-05-19", reading_time_seconds: 754 }],
    sync_runs: [{ id: "run", status: "complete", items_synced: 1 }],
    sync_state: [{ id: "matter", item_cursor: "task05-owned" }],
    counts: { items: 1, sessions: 1, tags: 1, links: 1, annotations: 1, daily: 1, runs: 1, sync_state: 1 },
    duration_total: 754,
    singleton: { count: 1, id: "matter", ownership_marker: "task05-owned" },
  };
  assert.doesNotThrow(() => assertLegacyPreserved(snapshot, structuredClone(snapshot)));
  const mutations = [
    (value) => { value.matter_tags[0].name = "changed"; },
    (value) => { value.sync_runs[0].id = "changed"; },
    (value) => { value.sync_runs[0].status = "failed"; },
    (value) => { value.sync_runs[0].items_synced = 2; },
    (value) => { value.reading_sessions[0].duration_seconds = 1; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.throws(() => assertLegacyPreserved(snapshot, changed), /upgrade changed legacy/);
  }
});

test("Task 20 upgrade snapshot excludes not-yet-installed Task 21 evidence but includes generation state", async () => {
  const { PRE_STATUS_TABLES } = await import("../scripts/stabilization-db-orchestrator.mjs");
  assert.ok(PRE_STATUS_TABLES.includes("reading_generation_control"));
  assert.ok(PRE_STATUS_TABLES.includes("matter_sync_streams"));
  assert.ok(!PRE_STATUS_TABLES.includes("matter_cycle_completions"));
  assert.ok(!PRE_STATUS_TABLES.includes("matter_invocation_status"));
});
