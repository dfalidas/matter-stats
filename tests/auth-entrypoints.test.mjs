import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = path.join(root, ".test-build");
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;

const redirect = (destination) => { throw Object.assign(new Error(`redirect:${destination}`), { destination }); };
const cookieJar = { token: undefined, writes: [] };
const nextHeaders = {
  cookies: async () => ({
    get: (name) => name === "matter_stats_session" && cookieJar.token ? { value: cookieJar.token } : undefined,
    set: (options) => { cookieJar.writes.push(options); cookieJar.token = options.maxAge === 0 ? undefined : options.value; },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "192.0.2.10" }),
};
const revalidated = [];
const syncState = {
  availabilityCalls: 0,
  syncCalls: 0,
  partialWrites: 0,
  result: { ok: true, message: "done" },
};
const matterSync = {
  getMatterSyncAvailability: async () => { syncState.availabilityCalls += 1; return { rateLimitedUntil: null, message: null }; },
  syncMatterData: async () => { syncState.syncCalls += 1; if (!syncState.result.ok) syncState.partialWrites += 1; return syncState.result; },
};

const storage = {
  sessions: new Map(),
  limiter: "ok",
  insert: "ok",
  lookup: "ok",
  revoke: "ok",
};
const client = {
  from(table) {
    assert.equal(table, "app_sessions");
    return {
      insert: async (row) => {
        if (storage.insert === "reject") throw new Error("SENSITIVE_INSERT_REJECTION");
        if (storage.insert === "error") return { error: new Error("SENSITIVE_INSERT_ERROR") };
        storage.sessions.set(row.token_hash, { ...row, revoked_at: null });
        return { error: null };
      },
      select: () => {
        let hash;
        const query = {
          eq(_field, value) { hash = value; return query; },
          async maybeSingle() {
            if (storage.lookup === "reject") throw new Error("SENSITIVE_LOOKUP_REJECTION");
            if (storage.lookup === "error") return { data: null, error: new Error("SENSITIVE_LOOKUP_ERROR") };
            return { data: storage.sessions.get(hash) ?? null, error: null };
          },
        };
        return query;
      },
      update: (patch) => ({ eq: async (_field, hash) => {
        if (storage.revoke === "reject") throw new Error("SENSITIVE_REVOKE_REJECTION");
        if (storage.revoke === "error") return { error: new Error("SENSITIVE_REVOKE_ERROR") };
        const row = storage.sessions.get(hash);
        if (row) Object.assign(row, patch);
        return { error: null };
      } }),
    };
  },
  async rpc() {
    if (storage.limiter === "reject") throw new Error("SENSITIVE_LIMITER_REJECTION");
    if (storage.limiter === "error") return { data: null, error: new Error("SENSITIVE_LIMITER_ERROR") };
    return { data: storage.limiter !== "rate", error: null };
  },
};

Module._resolveFilename = function(request, parent, isMain, options) {
  if (request.startsWith("@/")) request = path.join(buildRoot, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};
Module._load = function(request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "next/headers") return nextHeaders;
  if (request === "next/navigation") return { redirect };
  if (request === "next/cache") return { revalidatePath: (route) => revalidated.push(route) };
  if (request === "@/lib/supabase-admin" || request.endsWith("/.test-build/lib/supabase-admin")) return { getSupabaseAdminClient: () => client };
  if (request === "@/lib/matter-sync" || request.endsWith("/.test-build/lib/matter-sync")) return matterSync;
  return originalLoad.call(this, request, parent, isMain);
};

process.env.APP_ACCESS_PASSWORD = "synthetic-password";
process.env.APP_CREDENTIAL_VERSION = "1";
process.env.NODE_ENV = "production";

const authActions = await import(path.join(buildRoot, "lib/auth-actions.js"));
const { hashAuthValue } = await import(path.join(buildRoot, "lib/auth-cookie.js"));
const { requireAccessSession } = await import(path.join(buildRoot, "lib/require-auth.js"));
const dashboardActions = await import(path.join(buildRoot, "app/dashboard/actions.js"));

function reset() {
  storage.sessions.clear();
  storage.limiter = storage.insert = storage.lookup = storage.revoke = "ok";
  cookieJar.token = undefined;
  cookieJar.writes.length = 0;
  revalidated.length = 0;
  syncState.availabilityCalls = syncState.syncCalls = syncState.partialWrites = 0;
  syncState.result = { ok: true, message: "done" };
}
function loginForm(password) { const form = new FormData(); form.set("password", password); return form; }
async function expectRedirect(operation, destination) {
  await assert.rejects(operation, (error) => error?.destination === destination);
}
async function seedSession(overrides = {}) {
  const token = `token-${"x".repeat(40)}`;
  storage.sessions.set(await hashAuthValue(token), {
    token_hash: await hashAuthValue(token), credential_version: 1,
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null,
    ...overrides,
  });
  cookieJar.token = token;
  return token;
}

const paths = ["/dashboard", "/articles", "/reports", "/sources", "/authors", "/tags", "/year-in-reading", "/settings"];

test("actual login sets the secure cookie, stores only its hash, and redirects", async () => {
  reset();
  await expectRedirect(() => authActions.login({}, loginForm("synthetic-password")), "/dashboard");
  assert.equal(cookieJar.writes.length, 1);
  const written = cookieJar.writes[0];
  assert.deepEqual({ name: written.name, httpOnly: written.httpOnly, secure: written.secure, sameSite: written.sameSite, path: written.path, maxAge: written.maxAge },
    { name: "matter_stats_session", httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 2_592_000 });
  assert.equal(storage.sessions.size, 1);
  assert.equal([...storage.sessions.keys()][0], await hashAuthValue(written.value));
  assert.equal(JSON.stringify([...storage.sessions.values()]).includes(written.value), false);
});

test("actual login does not create sessions for wrong passwords or rate limits", async () => {
  for (const [password, limiter, message] of [["wrong", "ok", "Invalid password. Please try again."], ["synthetic-password", "rate", "Too many attempts. Please wait 15 minutes and try again."]]) {
    reset(); storage.limiter = limiter;
    assert.deepEqual(await authActions.login({}, loginForm(password)), { error: message });
    assert.equal(storage.sessions.size, 0); assert.equal(cookieJar.writes.length, 0);
  }
});

test("actual login sanitizes returned and rejected limiter and session failures", async () => {
  for (const [field, mode, reason] of [["limiter", "error", "limiter_unavailable"], ["limiter", "reject", "limiter_unavailable"], ["insert", "error", "session_storage_unavailable"], ["insert", "reject", "session_storage_unavailable"]]) {
    reset(); storage[field] = mode;
    const diagnostics = [];
    const saved = console.error;
    console.error = (...args) => diagnostics.push(args);
    try {
      assert.deepEqual(await authActions.login({}, loginForm("synthetic-password")), { error: "Sign-in is temporarily unavailable. Please try again later." });
    } finally { console.error = saved; }
    assert.deepEqual(diagnostics, [["auth_operation_failed", { operation: "login", reason }]]);
    assert.equal(JSON.stringify(diagnostics).includes("SENSITIVE_"), false);
    assert.equal(cookieJar.writes.length, 0);
  }
});

test("actual logout revokes, clears, redirects, and prevents replay", async () => {
  reset(); const token = await seedSession();
  await expectRedirect(() => authActions.logout(), "/login");
  assert.equal(cookieJar.writes.at(-1).maxAge, 0);
  cookieJar.token = token;
  await expectRedirect(() => requireAccessSession(), "/login");
});

test("actual logout does not clear or redirect when revocation fails", async () => {
  reset(); await seedSession(); storage.revoke = "error";
  await assert.rejects(() => authActions.logout(), /SENSITIVE_REVOKE_ERROR/);
  assert.equal(cookieJar.writes.length, 0);
});

test("actual page guard and actions fail closed before protected work", async () => {
  const cases = [
    async () => {},
    async () => seedSession({ expires_at: new Date(Date.now() - 1).toISOString() }),
    async () => seedSession({ revoked_at: new Date().toISOString() }),
    async () => seedSession({ credential_version: 2 }),
    async () => { await seedSession(); storage.lookup = "error"; },
    async () => { await seedSession(); storage.lookup = "reject"; },
  ];
  for (const arrange of cases) {
    reset(); await arrange();
    await expectRedirect(() => requireAccessSession(), "/login");
    assert.deepEqual(await dashboardActions.getMatterSyncAvailabilityAction(), { rateLimitedUntil: null, message: null });
    for (const mode of ["recent_activity_manual", "backfill_sessions", "backfill_library"]) {
      const form = new FormData(); form.set("mode", mode);
      assert.equal((await dashboardActions.syncMatterAction(null, form)).ok, false);
    }
    assert.equal(syncState.availabilityCalls, 0); assert.equal(syncState.syncCalls, 0); assert.equal(revalidated.length, 0);
  }
});

test("actual dashboard actions revalidate all paths after authorized success and partial failure", async () => {
  for (const result of [{ ok: true, message: "done" }, { ok: false, message: "partial failure" }]) {
    reset(); await seedSession(); syncState.result = result;
    assert.deepEqual(await dashboardActions.getMatterSyncAvailabilityAction(), { rateLimitedUntil: null, message: null });
    const returned = await dashboardActions.syncMatterAction(null);
    assert.equal(returned.ok, result.ok);
    assert.match(returned.message, /Durable status: Sessions status unavailable/);
    assert.ok(returned.message.startsWith(result.message));
    assert.equal(syncState.availabilityCalls, 1); assert.equal(syncState.syncCalls, 1);
    assert.equal(syncState.partialWrites, result.ok ? 0 : 1);
    assert.deepEqual(revalidated, paths);
  }
});
