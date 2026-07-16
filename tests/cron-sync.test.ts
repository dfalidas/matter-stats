import assert from "node:assert/strict";
import test from "node:test";

import { handleRecentActivityCron, type CronSyncDeps } from "../lib/cron-sync";

function createDeps(overrides: Partial<CronSyncDeps> = {}): CronSyncDeps {
  return {
    cronSecret: "expected",
    getAvailability: async () => ({ rateLimitedUntil: null, message: null }),
    syncRecentActivity: async () => ({ ok: true, message: "done" }),
    createRun: async () => ({ id: "run-1" }),
    updateRun: async (id) => ({ id }),
    now: () => new Date("2026-05-22T06:00:00.000Z"),
    ...overrides,
  };
}

test("GET without authorization returns 401", async () => {
  const response = await handleRecentActivityCron(new Request("https://example.com/api/cron/sync-recent-activity"), createDeps());
  assert.equal(response.status, 401);
});

test("GET with wrong bearer token returns 401", async () => {
  const response = await handleRecentActivityCron(
    new Request("https://example.com/api/cron/sync-recent-activity", { headers: { authorization: "Bearer wrong" } }),
    createDeps()
  );
  assert.equal(response.status, 401);
});

test("authorized cron request calls sync", async () => {
  let called = false;
  const response = await handleRecentActivityCron(
    new Request("https://example.com/api/cron/sync-recent-activity", { headers: { authorization: "Bearer expected" } }),
    createDeps({ syncRecentActivity: async () => ((called = true), { ok: true, message: "done", syncRunId: "run-1" }) })
  );
  assert.equal(response.status, 200);
  assert.equal(called, true);
});

test("rate-limited state causes safe skip", async () => {
  let syncCalled = false;
  let created = false;
  const response = await handleRecentActivityCron(
    new Request("https://example.com/api/cron/sync-recent-activity", { headers: { authorization: "Bearer expected" } }),
    createDeps({
      getAvailability: async () => ({ rateLimitedUntil: "2026-05-23T00:00:00.000Z", message: "limited" }),
      syncRecentActivity: async () => ((syncCalled = true), { ok: true, message: "should not run" }),
      createRun: async () => ((created = true), { id: "skip-run" }),
    })
  );
  assert.equal(response.status, 200);
  assert.equal(syncCalled, false);
  assert.equal(created, true);
});

test("expired rate-limited state still calls sync", async () => {
  let called = false;
  const response = await handleRecentActivityCron(
    new Request("https://example.com/api/cron/sync-recent-activity", { headers: { authorization: "Bearer expected" } }),
    createDeps({
      getAvailability: async () => ({ rateLimitedUntil: "2026-05-21T00:00:00.000Z", message: null }),
      syncRecentActivity: async () => ((called = true), { ok: true, message: "done", syncRunId: "run-1" }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(called, true);
});

test("cron does not call full-library backfill", async () => {
  let called = 0;
  await handleRecentActivityCron(
    new Request("https://example.com/api/cron/sync-recent-activity", { headers: { authorization: "Bearer expected" } }),
    createDeps({ syncRecentActivity: async () => ((called += 1), { ok: true, message: "recent" }) })
  );
  assert.equal(called, 1);
});
