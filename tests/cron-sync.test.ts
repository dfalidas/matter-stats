import assert from "node:assert/strict";
import test from "node:test";

import { handleRecentActivityCron, type CronSyncDeps } from "../lib/cron-sync";

function createDeps(overrides: Partial<CronSyncDeps> = {}): CronSyncDeps {
  return {
    cronSecret: "expected",
    syncRecentActivity: async () => ({ ok: true, message: "done" }),
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

test("query-string secret or session cookie alone returns 401 before downstream work", async () => {
  for (const request of [
    new Request("https://example.com/api/cron/sync-recent-activity?secret=expected"),
    new Request("https://example.com/api/cron/sync-recent-activity", { headers: { cookie: "matter_stats_session=valid" } }),
  ]) {
    let calls = 0;
    const response = await handleRecentActivityCron(request, createDeps({
      syncRecentActivity: async () => { calls += 1; return { ok: true, message: "done" }; },
    }));
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  }
});

test("authorized cron request calls sync", async () => {
  let called = 0;
  const response = await handleRecentActivityCron(
    new Request("https://example.com/api/cron/sync-recent-activity", { headers: { authorization: "Bearer expected" } }),
    createDeps({ syncRecentActivity: async () => ((called += 1), { ok: true, message: "done", syncRunId: "run-1" }) })
  );
  assert.equal(response.status, 200);
  assert.equal(called, 1);
});

for (const skippedReason of ["rate_limited", "busy"] as const) {
  test(`${skippedReason} is a controlled skip delegated to the leased runtime`, async () => {
    let calls = 0;
    const response = await handleRecentActivityCron(
      new Request("https://example.com/api/cron/sync-recent-activity", { headers: { authorization: "Bearer expected" } }),
      createDeps({ syncRecentActivity: async () => {
        calls += 1;
        return { ok: false, skippedReason, message: "skipped", rateLimitedUntil: skippedReason === "rate_limited" ? "2099-01-01T00:00:00Z" : null };
      } })
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    const result = await response.json();
    assert.equal(result.status, "skipped");
    assert.equal(result.skipped_reason, skippedReason);
  });
}

test("cron does not call full-library backfill", async () => {
  let called = 0;
  await handleRecentActivityCron(
    new Request("https://example.com/api/cron/sync-recent-activity", { headers: { authorization: "Bearer expected" } }),
    createDeps({ syncRecentActivity: async () => ((called += 1), { ok: true, message: "recent" }) })
  );
  assert.equal(called, 1);
});
