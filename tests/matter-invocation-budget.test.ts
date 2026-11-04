import assert from "node:assert/strict";
import test from "node:test";
import { MatterInvocationBudget, MatterBudgetStop, MATTER_INVOCATION_LIMITS, getMatterInvocationBudget, withMatterInvocationBudget } from "../lib/matter-invocation-budget";

test("invocation budgets validate finite bounds and reserve an entire expensive page", () => {
  for (const requests of [0, NaN, Infinity, 225, 1.5]) assert.throws(() => new MatterInvocationBudget({ ...MATTER_INVOCATION_LIMITS, requests }));
  assert.throws(() => new MatterInvocationBudget({} as typeof MATTER_INVOCATION_LIMITS));
  assert.throws(() => new MatterInvocationBudget({ ...MATTER_INVOCATION_LIMITS, pages: undefined } as unknown as typeof MATTER_INVOCATION_LIMITS));
  const budget = new MatterInvocationBudget();
  budget.pages = 1; budget.requests = 100;
  assert.throws(() => budget.admitPage(25), MatterBudgetStop);
  const fresh = new MatterInvocationBudget(); fresh.requests = 1;
  fresh.admitPage(100); // full 201-attempt preparation fits the production defaults
});
test("request and deadline stops include preparation and retain validated results", async () => {
  let now = 0;
  const budget = new MatterInvocationBudget({ ...MATTER_INVOCATION_LIMITS, requests: 2 }, () => now);
  await withMatterInvocationBudget(budget, async () => {
    assert.equal(getMatterInvocationBudget(), budget);
    await budget.attempt(async () => "me");
    await budget.attempt(async () => "item");
    await assert.rejects(budget.attempt(async () => "annotation"), (e: unknown) => e instanceof MatterBudgetStop && e.reason === "requests");
  });
  const timed = new MatterInvocationBudget(MATTER_INVOCATION_LIMITS, () => now);
  now = 89_999.75;
  assert.equal(timed.canRecover(), true);
  now = 90_000;
  assert.equal(timed.canRecover(), false);
  now = 0;
  assert.equal(await timed.attempt(async () => { now += 90_000; return "validated response"; }), "validated response");
  const finalizing = new MatterInvocationBudget(MATTER_INVOCATION_LIMITS, () => now);
  now += 140_000.75;
  assert.equal(finalizing.canRecover(), false);
  assert.equal(finalizing.remainingTotalMs(), 9_999);
  assert.doesNotThrow(() => AbortSignal.timeout(finalizing.remainingTotalMs()));
  now += 10_000;
  assert.equal(finalizing.remainingTotalMs(), 1);
  assert.equal(getMatterInvocationBudget(), undefined);
});
test("timeout cancels actual preparation with deterministic timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const budget = new MatterInvocationBudget({ ...MATTER_INVOCATION_LIMITS, requestMs: 10 });
  let signal: AbortSignal | undefined;
  const pending = budget.attempt(async (s) => { signal = s; return new Promise<never>(() => {}); });
  t.mock.timers.tick(10);
  await assert.rejects(pending, (e: unknown) => e instanceof MatterBudgetStop && e.reason === "timeout");
  assert.equal(signal?.aborted, true);
});
