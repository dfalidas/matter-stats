import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertDisposableDirectory, parseStatusEnv, runStabilizationDatabases, sanitizedEnvironment, SUPABASE_CLI_VERSION } from "../scripts/stabilization-db-orchestrator.mjs";

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
  const result = await runStabilizationDatabases({ evidenceRoot: root, hasDocker: () => false });
  assert.equal(result.status, "blocked");
  assert.equal(result.realDatabaseVerification, false);
  const stored = JSON.parse(await readFile(path.join(root, result.gitSha, "blocked.json"), "utf8"));
  assert.deepEqual(stored, result);
  assert.deepEqual(Object.keys(stored).sort(), ["gitSha", "realDatabaseVerification", "reason", "status"]);
});
