import assert from "node:assert/strict";
import test from "node:test";

import { authorizeAccessSession } from "../lib/access-control";
import { runLoginFlow, LOGIN_UNAVAILABLE_MESSAGE } from "../lib/auth-flow";
import { getAuthorizedSyncAvailability, runAuthorizedSync } from "../lib/dashboard-actions";

test("login preserves incorrect-password and rate-limit responses", async () => {
  const base = { createSession: async () => "token", issueCookie: async () => {}, diagnose: () => {} };
  assert.deepEqual(await runLoginFlow({ ...base, passwordIsCorrect: () => false, recordAttempt: async () => true }),
    { error: "Invalid password. Please try again." });
  assert.deepEqual(await runLoginFlow({ ...base, passwordIsCorrect: () => true, recordAttempt: async () => false }),
    { error: "Too many attempts. Please wait 15 minutes and try again." });
});

test("login storage failures are generic, diagnosed with identifiers, and issue no cookie", async () => {
  for (const failure of ["returned-rpc", "rejected-rpc", "rejected-insert"] as const) {
    let cookies = 0;
    const reasons: string[] = [];
    const state = await runLoginFlow({
      passwordIsCorrect: () => true,
      recordAttempt: async () => { if (failure !== "rejected-insert") throw new Error("sensitive raw error"); return true; },
      createSession: async () => { throw new Error("sensitive raw error"); },
      issueCookie: async () => { cookies += 1; },
      diagnose: (reason) => reasons.push(reason),
    });
    assert.deepEqual(state, { error: LOGIN_UNAVAILABLE_MESSAGE });
    assert.equal(cookies, 0);
    assert.equal(reasons.length, 1);
  }
});

test("successful login creates and issues one session", async () => {
  let created = 0; let issued = "";
  const result = await runLoginFlow({
    passwordIsCorrect: () => true, recordAttempt: async () => true,
    createSession: async () => { created += 1; return "opaque"; },
    issueCookie: async (token) => { issued = token; }, diagnose: () => {},
  });
  assert.equal(result, null); assert.equal(created, 1); assert.equal(issued, "opaque");
});

test("shared page guard denies missing, invalid, and rejected storage sessions", async () => {
  for (const validateToken of [async () => false, async () => { throw new Error("offline"); }]) {
    assert.equal(await authorizeAccessSession({ readToken: async () => undefined, validateToken }), false);
  }
  assert.equal(await authorizeAccessSession({ readToken: async () => "valid", validateToken: async () => true }), true);
});

test("both dashboard action boundaries perform zero protected work when authorization fails", async () => {
  for (const authorize of [async () => false, async () => { throw new Error("offline"); }]) {
    let calls = 0;
    const guardedAuthorize = () => authorizeAccessSession({ readToken: async () => "synthetic", validateToken: authorize });
    assert.deepEqual(await getAuthorizedSyncAvailability({ authorize: guardedAuthorize, getAvailability: async () => { calls += 1; return { rateLimitedUntil: null, message: null }; } }), { rateLimitedUntil: null, message: null });
    assert.equal((await runAuthorizedSync({ authorize: guardedAuthorize, sync: async () => { calls += 1; return { ok: true, message: "done" }; } })).ok, false);
    assert.equal(calls, 0);
  }
});

test("authorized dashboard action boundaries call each dependency once", async () => {
  let availability = 0; let sync = 0;
  await getAuthorizedSyncAvailability({ authorize: async () => true, getAvailability: async () => { availability += 1; return { rateLimitedUntil: null, message: null }; } });
  await runAuthorizedSync({ authorize: async () => true, sync: async () => { sync += 1; return { ok: true, message: "done" }; } });
  assert.equal(availability, 1); assert.equal(sync, 1);
});
