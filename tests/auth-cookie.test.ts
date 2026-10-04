import assert from "node:assert/strict";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any -- compact Supabase test double */

import {
  accessCookieOptions,
  createAccessSession,
  hashAuthValue,
  isValidAccessToken,
  LOGIN_ATTEMPT_LIMIT,
  isCorrectAccessPassword,
  recordLoginAttempt,
  revokeAccessSession,
} from "../lib/auth-cookie.js";

process.env.APP_ACCESS_PASSWORD = "synthetic-test-password";
process.env.APP_CREDENTIAL_VERSION = "1";

type Session = { token_hash: string; credential_version: number; created_at: string; expires_at: string; revoked_at: string | null };

function fakeClient() {
  const sessions: Session[] = [];
  const attempts = new Map<string, number>();
  let transactionTail = Promise.resolve();
  const from = () => ({
    insert: async (row: any) => { sessions.push(row); return { error: null }; },
    update: (patch: any) => ({ eq: async (_field: string, value: string) => {
      const row = sessions.find((entry) => entry.token_hash === value); if (row) Object.assign(row, patch); return { error: null };
    } }),
    select: () => {
      let tokenHash = "";
      const builder: any = {
        eq(_field: string, value: string) { tokenHash = value; return builder; },
        async maybeSingle() { return { data: sessions.find((entry) => entry.token_hash === tokenHash) ?? null, error: null }; },
      };
      return builder;
    },
  });
  const rpc = (_name: string, args: any) => {
    const operation = transactionTail.then(async () => {
      // Yield inside the critical section so the test exercises genuinely
      // overlapping callers while this double models the database lock.
      await new Promise((resolve) => setTimeout(resolve, 1));
      const count = attempts.get(args.p_client_key_hash) ?? 0;
      if (count >= args.p_limit) return { data: false, error: null };
      if (!args.p_succeeded) attempts.set(args.p_client_key_hash, count + 1);
      return { data: true, error: null };
    });
    transactionTail = operation.then(() => undefined);
    return operation;
  };
  return { client: { from, rpc } as any, sessions, attempts };
}

test("opaque sessions expire, revoke, and respect credential rotation", async () => {
  const db = fakeClient();
  const now = new Date("2026-09-29T12:00:00Z");
  const token = await createAccessSession(db.client, now);
  assert.equal(db.sessions[0]?.token_hash, await hashAuthValue(token));
  assert.notEqual(db.sessions[0]?.token_hash, token);
  assert.equal(await isValidAccessToken(db.client, token, now), true);
  const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(await isValidAccessToken(db.client, token, new Date(expiry.getTime() - 1)), true);
  assert.equal(await isValidAccessToken(db.client, token, expiry), false);
  process.env.APP_CREDENTIAL_VERSION = "2";
  assert.equal(await isValidAccessToken(db.client, token, now), false);
  process.env.APP_CREDENTIAL_VERSION = "1";
  await revokeAccessSession(db.client, token, now);
  assert.equal(await isValidAccessToken(db.client, token, now), false);
});

test("shared password accepts the configured value and rejects an incorrect value", () => {
  assert.equal(isCorrectAccessPassword("synthetic-test-password"), true);
  assert.equal(isCorrectAccessPassword("incorrect-password"), false);
});

test("malformed and storage-error tokens fail closed", async () => {
  const db = fakeClient();
  assert.equal(await isValidAccessToken(db.client, undefined), false);
  assert.equal(await isValidAccessToken(db.client, "short"), false);
  assert.equal(await isValidAccessToken(db.client, "z".repeat(43)), false);
  const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error("offline") }) }) }) }) } as any;
  assert.equal(await isValidAccessToken(broken, "x".repeat(43)), false);
  const rejected = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { throw new Error("offline"); } }) }) }) } as any;
  assert.equal(await isValidAccessToken(rejected, "x".repeat(43)), false);
});

test("successful session stores only its hash and retains secure cookie attributes", async () => {
  const db = fakeClient();
  const token = await createAccessSession(db.client);
  assert.equal(JSON.stringify(db.sessions).includes(token), false);
  assert.deepEqual(accessCookieOptions(token, true), {
    name: "matter_stats_session", value: token, httpOnly: true, secure: true,
    sameSite: "lax", path: "/", maxAge: 2_592_000,
  });
});

test("failed revocation rejects and cannot be reported as successful", async () => {
  const broken = { from: () => ({ update: () => ({ eq: async () => ({ error: new Error("offline") }) }) }) } as any;
  await assert.rejects(revokeAccessSession(broken, "x".repeat(43)));
});

test("returned and rejected login storage failures propagate to the controlled flow", async () => {
  const returnedError = {
    from: () => ({ insert: async () => ({ error: new Error("insert failed") }) }),
    rpc: async () => ({ data: null, error: new Error("rpc missing") }),
  } as any;
  await assert.rejects(createAccessSession(returnedError));
  await assert.rejects(recordLoginAttempt(returnedError, "synthetic-client", true));

  const rejected = {
    from: () => ({ insert: async () => { throw new Error("network failed"); } }),
    rpc: async () => { throw new Error("network failed"); },
  } as any;
  await assert.rejects(createAccessSession(rejected));
  await assert.rejects(recordLoginAttempt(rejected, "synthetic-client", true));
});

test("twenty concurrent attempts atomically allow only the configured limit", async () => {
  const db = fakeClient();
  const results = await Promise.all(Array.from(
    { length: 20 },
    () => recordLoginAttempt(db.client, "203.0.113.7", false),
  ));
  assert.equal(results.filter(Boolean).length, LOGIN_ATTEMPT_LIMIT);
  assert.equal(results.filter((allowed) => !allowed).length, 20 - LOGIN_ATTEMPT_LIMIT);
  assert.equal([...db.attempts.values()][0], LOGIN_ATTEMPT_LIMIT);
  assert.equal(await recordLoginAttempt(db.client, "198.51.100.4", false), true);
});
