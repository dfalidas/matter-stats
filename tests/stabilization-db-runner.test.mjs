import assert from "node:assert/strict";
import test from "node:test";
import { ACKNOWLEDGEMENT, assertSafeInvocation, sanitizedEnvironment, settleAndCleanup } from "../scripts/stabilization-db-runner.mjs";

test("runner requires the exact disposable acknowledgement", () => {
  assert.throws(() => assertSafeInvocation({}), /Refusing to run/);
  assert.throws(() => assertSafeInvocation({ STABILIZATION_TEST_DISPOSABLE_ACK: "yes" }), /Refusing to run/);
  assert.doesNotThrow(() => assertSafeInvocation({ STABILIZATION_TEST_DISPOSABLE_ACK: ACKNOWLEDGEMENT }));
});

test("runner refuses environment hints that could target a remote project", () => {
  assert.throws(() => assertSafeInvocation({ STABILIZATION_TEST_DISPOSABLE_ACK: ACKNOWLEDGEMENT, SUPABASE_ACCESS_TOKEN: "secret" }), /remote-link variable/);
});

test("Data API child environment never falls back to application variables", () => {
  const env = sanitizedEnvironment({ PATH: "/bin", HOME: "/tmp", SUPABASE_URL: "production", SUPABASE_SERVICE_ROLE_KEY: "production-secret" }, {
    API_URL: "http://127.0.0.1:1234", ANON_KEY: "anon", SERVICE_ROLE_KEY: "service",
  });
  assert.equal(env.STABILIZATION_TEST_SUPABASE_URL, "http://127.0.0.1:1234");
  assert.equal(env.SUPABASE_URL, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
});

test("cleanup runs after failure and both failures remain visible", async () => {
  const events = [];
  await assert.rejects(() => settleAndCleanup(async () => { events.push("work"); throw new Error("work failed"); }, async () => {
    events.push("cleanup"); throw new Error("cleanup failed");
  }), (error) => error instanceof AggregateError && error.errors.length === 2);
  assert.deepEqual(events, ["work", "cleanup"]);
});
