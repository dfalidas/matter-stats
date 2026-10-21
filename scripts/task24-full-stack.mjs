#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  readFile,
  writeFile,
} from "node:fs/promises";
import { writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { executionIdentity, phaseRecorder } from "./database-evidence.mjs";
import {
  command,
  cli,
  configureStack,
  copyMigrations,
  containerPsql,
  configureDisposableGateway,
  disposableDiagnostics,
  parseStatusEnv,
  sanitizedEnvironment,
  SUPABASE_CLI_VERSION,
} from "./stabilization-db-orchestrator.mjs";
import {
  verifyCatalog,
  repositoryMigrationVersions,
} from "./stabilization-db-runner.mjs";
import { assertLocalOrigin } from "./task24-transport.mjs";
import { syntheticMatter } from "./task24-fixtures.mjs";
import { runJourneys, JOURNEYS } from "./task24-journeys.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const identity = executionIdentity();
const output = path.join(
  root,
  "artifacts/task24",
  identity.testedSha,
  new Date().toISOString().replaceAll(":", "-"),
);
await mkdir(output, { recursive: true });
const save = (name, value) =>
  writeFileSync(
    path.join(output, `${name}.json`),
    JSON.stringify(value, null, 2) + "\n",
  );
const hashes = {};
for (const file of [
  "task24-full-stack.mjs",
  "task24-app.mjs",
  "task24-transport.mjs",
  "task24-fixtures.mjs",
  "task24-journeys.mjs",
])
  hashes[file] = createHash("sha256")
    .update(await readFile(path.join(root, "scripts", file)))
    .digest("hex");
const event = process.env.GITHUB_EVENT_PATH
  ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
  : {};
const baseSha =
  event.pull_request?.base?.sha ??
  (identity.event === "push"
    ? event.before
    : command("git", ["merge-base", "origin/main", "HEAD"]).trim());
save("identity", {
  ...identity,
  baseSha,
  applicationSha: identity.testedSha,
  buildSha: identity.testedSha,
  harnessSha: identity.testedSha,
  harnessContentHashes: hashes,
  environment: "B: local isolated full-stack",
  appTimezone: "Europe/Athens",
  browserTimezone: "America/New_York",
  hostedStaging: "blocked",
  production: "not-run",
  scheduledDelivery: "not-run",
  startedAt: new Date().toISOString(),
});
const phases = phaseRecorder(
  [
    "prerequisites",
    "owned-stack",
    "migrations",
    "production-build",
    ...JOURNEYS,
    "cleanup",
  ],
  (value) => {
    save("outcomes", value);
    const active = value.steps.find((row) => row.status === "running");
    if (active) console.log(`Task 24: ${active.name}`);
  },
);
let directory, stack, app, browser, state;
const children = new Set();
const observations = {
  matter: [],
  databaseRequests: 0,
  injectedFaults: 0,
  unexpectedNetwork: 0,
  serverOutputLines: 0,
};
const cleanup = {
  applicationProcesses: "not-created",
  browser: "not-created",
  stack: "not-created",
  temporaryDirectory: "not-created",
};
save("cleanup", cleanup);
const stopApp = async () => {
  if (!app) return;
  const child = app;
  app = undefined;
  if (child.exitCode === null && child.signalCode === null)
    await new Promise((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  children.delete(child);
};
try {
  phases.begin("prerequisites");
  assert.equal(
    process.env.DISPOSABLE_DB_ACK,
    "yes",
    "explicit disposable acknowledgement required",
  );
  assert.equal(
    process.versions.node.split(".")[0],
    "22",
    "supported Node 22 required",
  );
  assert.equal(cli(["--version"]).trim(), SUPABASE_CLI_VERSION);
  command("docker", ["info"]);
  // Next loads dotenv even with a sanitized process environment. Refuse those
  // files rather than risk importing a real target or credential from disk.
  assert.deepEqual(
    (await readdir(root)).filter(
      (name) => /^\.env(?:$|\.)/.test(name) && name !== ".env.example",
    ),
    [],
    "remove dotenv files from the verification checkout",
  );
  assert.equal(process.argv.length, 2, "no database target arguments accepted");
  directory = await mkdtemp(path.join(os.tmpdir(), "matter-stats-task24-"));
  cleanup.temporaryDirectory = "pending";
  save("cleanup", cleanup);
  const suffix = `${process.pid}-${randomBytes(6).toString("hex")}`;
  stack = {
    name: "fresh",
    projectId: `matter-stats-fresh-task24-${suffix}`,
    workdir: path.join(directory, "supabase-stack"),
    apiPort: 58421,
    dbPort: 58422,
    shadowPort: 58420,
    studioPort: 58423,
    inbucketPort: 58424,
    analyticsPort: 58427,
  };
  const resourceLists = [
    ["ps", "-a"],
    ["volume", "ls"],
    ["network", "ls"],
  ];
  for (const args of resourceLists)
    assert.equal(
      command("docker", [
        ...args,
        "--filter",
        `name=_${stack.projectId}$`,
        "--format",
        "{{.ID}}",
      ]).trim(),
      "",
      "existing resource refused",
    );
  phases.end();
  phases.begin("owned-stack");
  await configureStack(stack.workdir, stack);
  await copyMigrations(stack.workdir);
  cleanup.stack = "pending";
  save("cleanup", cleanup);
  // Only unused services are excluded. Real Postgres, PostgREST, Kong and Auth
  // stay enabled; the complete Task 23 stack and suites are unchanged.
  cli([
    "start",
    "--workdir",
    stack.workdir,
    "--exclude",
    "realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
  ]);
  configureDisposableGateway(stack.projectId);
  const status = parseStatusEnv(
    cli(["status", "--workdir", stack.workdir, "-o", "env"]),
  );
  assertLocalOrigin(status.API_URL);
  assert.equal(new URL(status.API_URL).port, String(stack.apiPort));
  // CLI bootstrap keys never enter evidence. Replace the owned Kong service key
  // with a freshly signed JWT; the app never uses a hosted/inherited key.
  assert.ok(status.JWT_SECRET && status.SERVICE_ROLE_KEY);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const jwtInput = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role: "service_role", iss: "supabase", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, jti: randomBytes(24).toString("hex") })}`;
  const freshKey = `${jwtInput}.${createHmac("sha256", status.JWT_SECRET).update(jwtInput).digest("base64url")}`;
  const gatewayFile = "/home/kong/kong.yml";
  const gateway = `supabase_kong_${stack.projectId}`;
  const gatewayConfig = command("docker", [
    "exec",
    gateway,
    "cat",
    gatewayFile,
  ]);
  assert.ok(gatewayConfig.includes(status.SERVICE_ROLE_KEY));
  command(
    "docker",
    ["exec", "-i", gateway, "sh", "-c", `cat > ${gatewayFile}`],
    { input: gatewayConfig.replaceAll(status.SERVICE_ROLE_KEY, freshKey) },
  );
  configureDisposableGateway(stack.projectId);
  status.SERVICE_ROLE_KEY = freshKey;
  phases.end();
  phases.begin("migrations");
  const sql = (statement) => containerPsql(stack.projectId, statement).trim();
  const inventory = await verifyCatalog({
    migrationsDir: path.join(root, "supabase/migrations"),
    execute: (statement) => sql(statement).split(/\r?\n/).filter(Boolean),
  });
  assert.deepEqual(
    inventory,
    await repositoryMigrationVersions(path.join(root, "supabase/migrations")),
  );
  save("database", {
    status: "passed",
    migrations: inventory,
    realSqlAndDataApi: true,
    phaseCountsAreGroups: true,
  });
  phases.end();
  const credentials = {
    password: randomBytes(32).toString("base64url"),
    cron: randomBytes(32).toString("base64url"),
    matter: randomBytes(32).toString("base64url"),
  };
  const appEnv = (version) =>
    sanitizedEnvironment({
      NODE_ENV: "production",
      DISPOSABLE_DB_ACK: "yes",
      APP_ACCESS_PASSWORD: credentials.password,
      APP_CREDENTIAL_VERSION: String(version),
      CRON_SECRET: credentials.cron,
      MATTER_API_TOKEN: credentials.matter,
      SUPABASE_URL: status.API_URL,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      APP_TIMEZONE: "Europe/Athens",
      NEXT_TELEMETRY_DISABLED: "1",
    });
  phases.begin("production-build");
  command("npm", ["run", "build"], { env: appEnv(1) });
  save("build", {
    status: "passed",
    sourceSha: identity.testedSha,
    worktreeDirty: identity.worktreeDirty,
    buildId: (await readFile(".next/BUILD_ID", "utf8")).trim(),
  });
  phases.end();
  const origin = "http://localhost:3094";
  state = { fault: null, hold: false, dropAfter: false };
  const startApp = async (version = 1) => {
    await stopApp();
    app = spawn(process.execPath, ["scripts/task24-app.mjs"], {
      cwd: root,
      env: appEnv(version),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.add(app);
    cleanup.applicationProcesses = "pending";
    save("cleanup", cleanup);
    app.stdout.on("data", (data) => {
      observations.serverOutputLines += data.toString().split("\n").length - 1;
    });
    app.stderr.on("data", (data) => {
      observations.serverOutputLines += data.toString().split("\n").length - 1;
    });
    app.on("message", (message) => {
      if (message.type === "unexpected-network") {
        observations.unexpectedNetwork++;
        return;
      }
      if (message.type !== "request") return;
      let decision;
      try {
        if (message.matter) {
          observations.matter.push({
            path: message.path,
            page: message.query.cursor
              ? Number(message.query.cursor.replace("task24-page-", ""))
              : 0,
          });
          if (state.fault === "429")
            decision = {
              kind: "synthetic",
              status: 429,
              headers: { "Retry-After": "2" },
              body: { message: "Synthetic rate limit" },
            };
          else if (state.fault === "timeout") {
            decision = {
              kind: "synthetic",
              delay: 11000,
              body: { object: "account", id: "task24-synthetic-account" },
            };
            state.fault = null; // One real production timeout, then natural retry.
          } else if (state.fault === "interrupt") {
            decision = { kind: "drop" };
            state.fault = null; // One interrupted attempt, never a quota reset.
          } else decision = syntheticMatter(message, state);
          if (state.onMatter) state.onMatter(message);
        } else {
          observations.databaseRequests++;
          const endpoint = message.path.split("/").at(-1);
          if (endpoint === "app_sessions" && state.authReadControl) {
            state.authReadControl.reads++;
            if (state.authReadControl.reads === 2)
              state.authReadControl.onSecond();
          }
          decision = { kind: "real" };
          if (
            state.fault === endpoint ||
            (state.fault === "metrics" &&
              ["reading_sessions", "read_generation_days"].includes(endpoint))
          )
            decision = { kind: "fault" };
          if (state.dropAfter && endpoint === "commit_matter_page") {
            state.dropAfter = false;
            decision = { kind: "drop-after" };
          }
        }
      } catch {
        observations.unexpectedNetwork++;
        decision = { kind: "drop" };
      }
      if (decision.kind !== "real" && !message.matter)
        observations.injectedFaults++;
      app?.send({ type: "decision", id: message.id, decision });
    });
    app.send({
      type: "configure",
      database: status.API_URL,
      application: origin,
      directory: root,
      port: 3094,
    });
    let ready = false;
    for (let i = 0; i < 150; i++) {
      assert.equal(app.exitCode, null, "production app exited during startup");
      try {
        if (
          (
            await fetch(`${origin}/login`, {
              signal: AbortSignal.timeout(1000),
            })
          ).status === 200
        ) {
          ready = true;
          break;
        }
      } catch {
        /* bounded startup only */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "production app startup timeout");
  };
  browser = await chromium.launch({ headless: true });
  cleanup.browser = "pending";
  save("cleanup", cleanup);
  save("toolchain", {
    node: identity.node,
    npm: identity.npm,
    supabase: SUPABASE_CLI_VERSION,
    playwright: JSON.parse(
      await readFile("node_modules/playwright/package.json", "utf8"),
    ).version,
    browser: browser.version(),
    next: JSON.parse(await readFile("node_modules/next/package.json", "utf8"))
      .version,
  });
  await startApp();
  await runJourneys({
    browser,
    origin,
    credentials,
    sql,
    state,
    observations,
    startApp,
    output,
    phases,
    save,
    secrets: [
      credentials.password,
      credentials.cron,
      credentials.matter,
      freshKey,
    ],
  });
  assert.equal(observations.unexpectedNetwork, 0);
  save("network", {
    ...observations,
    matter: {
      requests: observations.matter.length,
      paths: [...new Set(observations.matter.map((row) => row.path))],
    },
    realMatterRequests: 0,
  });
} catch (error) {
  phases.fail(error.failureKind);
  save("failure", {
    status: error.failureKind === "infrastructure" ? "blocked" : "failed",
    category: error.category ?? error.name,
    rawDetailsWithheld: true,
    infrastructureReason: error.infrastructureReason ?? null,
    disposableDiagnostics:
      stack && cleanup.stack === "pending"
        ? disposableDiagnostics(stack.projectId)
        : [],
  });
  // Private local debugging only; explicit artifact allowlist excludes work/.
  await mkdir("work", { recursive: true });
  await writeFile(
    "work/task24-private-failure.txt",
    error.stack ?? String(error),
    { mode: 0o600 },
  );
  process.exitCode = error.failureKind === "infrastructure" ? 2 : 1;
} finally {
  save("network", {
    ...observations,
    matter: {
      requests: observations.matter.length,
      paths: [...new Set(observations.matter.map((row) => row.path))],
    },
    realMatterRequests: 0,
  });
  phases.begin("cleanup");
  try {
    await stopApp();
    assert.equal(children.size, 0);
    if (cleanup.applicationProcesses === "pending")
      cleanup.applicationProcesses = "verified-removed";
  } catch {
    cleanup.applicationProcesses = "failed";
  }
  try {
    await browser?.close();
    cleanup.browser = browser ? "verified-closed" : "not-created";
  } catch {
    cleanup.browser = "failed";
  }
  if (cleanup.stack === "pending")
    try {
      cli(["stop", "--workdir", stack.workdir, "--no-backup"]);
      for (const args of [
        ["ps", "-a"],
        ["volume", "ls"],
        ["network", "ls"],
      ])
        assert.equal(
          command("docker", [
            ...args,
            "--filter",
            `name=_${stack.projectId}$`,
            "--format",
            "{{.ID}}",
          ]).trim(),
          "",
        );
      cleanup.stack = "verified-removed";
    } catch {
      cleanup.stack = "failed";
    }
  if (directory && !Object.values(cleanup).includes("failed")) {
    await rm(directory, { recursive: true, force: true });
    cleanup.temporaryDirectory = "verified-removed";
  }
  save("cleanup", cleanup);
  if (Object.values(cleanup).includes("failed")) {
    phases.fail("infrastructure");
    process.exitCode = 2;
  } else phases.end();
  console.log(
    `Sanitized Task 24 evidence: ${path.relative(root, output)}; exit ${process.exitCode ?? 0}`,
  );
}
