import assert from "node:assert/strict";
import test from "node:test";
import { MatterBudgetStop, MatterInvocationBudget } from "../lib/matter-invocation-budget";
import { parseRetryAfterHeader } from "../lib/matter-sync-progress";
import { strictMatterInteger, strictMatterReset, matterCooldownDeadline, matterRetryDelay, isTransientMatterFailure, MATTER_RETRY_MAX_ATTEMPTS } from "../lib/matter-request-policy";
test("Task 15: strict feedback rejects permissive numbers and invalid calendars", () => {
  const now = Date.parse("2026-10-08T00:00:00Z");
  for (const raw of ["1.5", "12junk", "-1", " 2", "Infinity", "1e2", "9007199254740992", ""]) {
    assert.equal(strictMatterInteger(raw), null); assert.equal(parseRetryAfterHeader(raw, now), null);
  }
  assert.equal(strictMatterInteger("0"), 0);
  assert.equal(strictMatterReset(String(now / 1000), now), null);
  assert.equal(strictMatterReset(String(now / 1000 + 30), now), now / 1000 + 30);
  assert.equal(parseRetryAfterHeader("Thu, 08 Oct 2026 00:00:30 GMT", now), 30);
  assert.equal(parseRetryAfterHeader("Fri, 08 Oct 2026 00:00:30 GMT", now), null);
  assert.equal(parseRetryAfterHeader("Tue, 31 Feb 2026 00:00:00 GMT", now), null);
  assert.equal(parseRetryAfterHeader("86401", now), 86401, "long valid cooldown is honored without sleeping");
  assert.equal(matterCooldownDeadline(null, null, now), now + 60000);
  assert.equal(matterCooldownDeadline(2, now / 1000 + 90, now), now + 90000);
});
test("Task 15: exact retry bounds/classification and upstream finalization margin", () => {
  assert.equal(MATTER_RETRY_MAX_ATTEMPTS, 3);
  assert.deepEqual([1,2,3].map((attempt) => matterRetryDelay(attempt, () => 0)), [500,1000,2000]);
  assert.deepEqual([1,2,3].map((attempt) => matterRetryDelay(attempt, () => 0.999)), [750,1250,2000]);
  for (const status of [500,502,503,504]) assert.equal(isTransientMatterFailure({ status }), true);
  for (const status of [400,401,403,404,422,429,501,505]) assert.equal(isTransientMatterFailure({ status }), false);
  assert.equal(isTransientMatterFailure(new TypeError("generic")), false);
  assert.equal(isTransientMatterFailure(new TypeError("reset", { cause: { code: "ECONNRESET" } })), true);
  assert.equal(isTransientMatterFailure(new MatterBudgetStop("timeout")), true);
  for (const reason of ["requests","deadline","pages"] as const) assert.equal(isTransientMatterFailure(new MatterBudgetStop(reason)), false);
  let clock=0; const budget = new MatterInvocationBudget(undefined,()=>clock);
  clock=79000; assert.throws(()=>budget.checkWait(1000), /deadline/);
});
