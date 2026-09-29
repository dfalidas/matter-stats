import assert from "node:assert/strict";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- compact Supabase fluent-query test double */

import {
  createAccessSession,
  getLoginRateLimit,
  hashAuthValue,
  isValidAccessToken,
  LOGIN_ATTEMPT_LIMIT,
  recordLoginAttempt,
  revokeAccessSession,
} from "../lib/auth-cookie.js";

process.env.APP_ACCESS_PASSWORD = "synthetic-test-password";
process.env.APP_CREDENTIAL_VERSION = "1";

type Session = { token_hash: string; credential_version: number; created_at: string; expires_at: string; revoked_at: string | null };
type Attempt = { client_key_hash: string; attempted_at: string; succeeded: boolean };

function fakeClient() {
  const sessions: Session[] = [];
  const attempts: Attempt[] = [];
  const from = (table: string) => ({
    insert: async (row: any) => { (table === "app_sessions" ? sessions : attempts).push(row); return { error: null }; },
    update: (patch: any) => ({ eq: async (_field: string, value: string) => {
      const row = sessions.find((entry) => entry.token_hash === value); if (row) Object.assign(row, patch); return { error: null };
    } }),
    select: (_columns: string, options?: { head?: boolean }) => {
      let tokenHash = ""; let clientHash = ""; let since = ""; let failedOnly = false;
      const builder: any = {
        eq(field: string, value: any) { if (field === "token_hash") tokenHash = value; if (field === "client_key_hash") clientHash = value; if (field === "succeeded") failedOnly = value === false; return builder; },
        gte(_field: string, value: string) { since = value; return builder; },
        async maybeSingle() { return { data: sessions.find((entry) => entry.token_hash === tokenHash) ?? null, error: null }; },
        then(resolve: (result: any) => void) { const count = attempts.filter((a) => a.client_key_hash === clientHash && (!failedOnly || !a.succeeded) && a.attempted_at >= since).length; resolve({ count, error: null }); },
      };
      return builder;
    },
  });
  return { client: { from } as any, sessions, attempts };
}

test("opaque sessions expire, revoke, and respect credential rotation", async () => {
  const db = fakeClient();
  const now = new Date("2026-09-29T12:00:00Z");
  const token = await createAccessSession(db.client, now);
  assert.equal(db.sessions[0]?.token_hash, await hashAuthValue(token));
  assert.notEqual(db.sessions[0]?.token_hash, token);
  assert.equal(await isValidAccessToken(db.client, token, now), true);
  assert.equal(await isValidAccessToken(db.client, token, new Date("2026-10-30T12:00:01Z")), false);
  process.env.APP_CREDENTIAL_VERSION = "2";
  assert.equal(await isValidAccessToken(db.client, token, now), false);
  process.env.APP_CREDENTIAL_VERSION = "1";
  await revokeAccessSession(db.client, token, now);
  assert.equal(await isValidAccessToken(db.client, token, now), false);
});

test("malformed and storage-error tokens fail closed", async () => {
  const db = fakeClient();
  assert.equal(await isValidAccessToken(db.client, "short"), false);
  const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error("offline") }) }) }) }) } as any;
  assert.equal(await isValidAccessToken(broken, "x".repeat(43)), false);
});

test("login limiter is shared through persisted attempts and scoped per client", async () => {
  const db = fakeClient();
  const now = new Date("2026-09-29T12:00:00Z");
  const first = await getLoginRateLimit(db.client, "203.0.113.7", now);
  for (let index = 0; index < LOGIN_ATTEMPT_LIMIT; index += 1) await recordLoginAttempt(db.client, first.clientKeyHash, false, now);
  assert.equal((await getLoginRateLimit(db.client, "203.0.113.7", now)).allowed, false);
  assert.equal((await getLoginRateLimit(db.client, "198.51.100.4", now)).allowed, true);
  assert.equal((await getLoginRateLimit(db.client, "203.0.113.7", new Date("2026-09-29T12:16:00Z"))).allowed, true);
});
