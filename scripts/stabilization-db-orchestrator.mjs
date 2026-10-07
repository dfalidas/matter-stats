#!/usr/bin/env node
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { verifyCatalog } from "./stabilization-db-runner.mjs";

export const SUPABASE_CLI_VERSION = "2.48.3";
export const UPGRADE_BASELINE = "20260519090000";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsSource = path.join(repoRoot, "supabase/migrations");

export function sanitizedEnvironment(extra = {}) {
  const keep = ["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP", "SystemRoot", "COMSPEC", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "npm_config_cache", "npm_config_https_proxy"];
  return Object.fromEntries([...keep.filter((key) => process.env[key]).map((key) => [key, process.env[key]]), ...Object.entries(extra)]);
}

export function parseStatusEnv(output) {
  return Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    return match ? [[match[1], match[2].replace(/"$/, "")]] : [];
  }));
}

export function assertDisposableDirectory(directory) {
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep), "stack workdir must be below the OS temporary directory");
  assert.notEqual(resolved, repoRoot, "refusing to operate on the repository Supabase directory");
}

function command(binary, args, { cwd = repoRoot, env = sanitizedEnvironment(), input } = {}) {
  const result = spawnSync(binary, args, { cwd, env, input, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${binary} ${args.join(" ")} failed (${result.status}): ${result.stderr.trim()}`);
  return result.stdout;
}

function cli(args, options) {
  return command("npx", ["--yes", `supabase@${SUPABASE_CLI_VERSION}`, ...args], options);
}

function dockerAvailable() {
  const executable = process.platform === "win32" ? "docker.exe" : "docker";
  const result = spawnSync(executable, ["info"], { encoding: "utf8", env: sanitizedEnvironment() });
  return !result.error && result.status === 0;
}

// Failure-only disposable diagnostics. Never retain raw logs, environment,
// container identifiers or generated local credentials in evidence artifacts.
function disposableDiagnostics(projectId) {
  return ["kong", "rest", "db"].map((component) => {
    const container = `supabase_${component}_${projectId}`;
    const options = { encoding:"utf8", env:sanitizedEnvironment(), timeout:5000, maxBuffer:1024*1024 };
    const inspected = spawnSync("docker",["inspect","--format","{{json .State}}",container],options);
    let state;
    try { state=JSON.parse(inspected.stdout); } catch { /* unavailable remains explicit */ }
    const logged = spawnSync("docker",["logs","--tail","500",container],options);
    const lines = `${logged.stdout ?? ""}\n${logged.stderr ?? ""}`.split(/\r?\n/);
    return {
      component,
      stateAvailable:inspected.status===0 && Boolean(state),
      running:state?.Running===true,
      outOfMemory:state?.OOMKilled===true,
      exitCode:Number.isInteger(state?.ExitCode)?state.ExitCode:null,
      logsAvailable:logged.status===0,
      errorCounts:{
        upstream:lines.filter((line)=>/upstream.*(?:invalid|timed out|closed|refused|error)|no live upstream/i.test(line)).length,
        workerConnections:lines.filter((line)=>/worker_connections|too many open files/i.test(line)).length,
        databaseConnections:lines.filter((line)=>/too many clients|remaining connection slots|connection pool.*(?:timeout|exhaust)/i.test(line)).length,
        postgrest:lines.filter((line)=>/PGRST[0-9]{3}/.test(line)).length,
      },
    };
  });
}

async function configureStack(workdir, { projectId, apiPort, dbPort, shadowPort, studioPort, inbucketPort, analyticsPort }) {
  assertDisposableDirectory(workdir);
  await mkdir(workdir, { recursive: true });
  cli(["init", "--workdir", workdir], { env: sanitizedEnvironment() });
  const configPath = path.join(workdir, "supabase/config.toml");
  let config = await readFile(configPath, "utf8");
  config = config
    .replace(/^project_id = .*$/m, `project_id = "${projectId}"`)
    .replace(/^port = 54321$/m, `port = ${apiPort}`)
    .replace(/^port = 54322$/m, `port = ${dbPort}`)
    .replace(/^shadow_port = 54320$/m, `shadow_port = ${shadowPort}`)
    .replace(/^port = 54323$/m, `port = ${studioPort}`)
    .replace(/^port = 54324$/m, `port = ${inbucketPort}`)
    .replace(/^port = 54327$/m, `port = ${analyticsPort}`)
    .replace(/^port = 54329$/m, `port = ${analyticsPort + 2}`);
  await writeFile(configPath, config);
}

async function copyMigrations(workdir, predicate = () => true) {
  const target = path.join(workdir, "supabase/migrations");
  await mkdir(target, { recursive: true });
  for (const filename of (await readdir(migrationsSource)).filter((name) => name.endsWith(".sql") && predicate(name)).sort()) {
    await cp(path.join(migrationsSource, filename), path.join(target, filename));
  }
}

export function legacySeedSql(ownershipMarker) {
  assert.match(ownershipMarker, /^[a-zA-Z0-9_-]+$/, "invalid singleton ownership marker");
  return String.raw`
insert into public.matter_items (id,title,source,word_count,progress) values ('legacy-item','Legacy title','legacy.example',1200,0.5);
insert into public.reading_sessions (id,item_id,started_at,ended_at,duration_seconds,words_estimated) values ('legacy-session','legacy-item','2026-05-19T10:00:00Z','2026-05-19T10:12:34Z',754,2830);
insert into public.matter_tags (id,name) values ('legacy-tag','Legacy tag');
insert into public.item_tags (item_id,tag_id) values ('legacy-item','legacy-tag');
insert into public.annotations (id,item_id,text,note) values ('legacy-annotation','legacy-item','Legacy highlight','Legacy note');
insert into public.daily_stats (date,reading_time_seconds,words_read,sessions_count,items_read_count,highlights_count,top_source) values ('2026-05-19',754,2830,1,1,1,'legacy.example');
insert into public.sync_runs (id,status,items_synced,sessions_synced,annotations_synced,tags_synced) values ('00000000-0000-4000-8000-000000000059','complete',1,1,1,1);
insert into public.sync_state (id,active_phase,sync_mode,item_cursor,recent_activity_checkpoint) values ('matter','sessions','recent_activity','${ownershipMarker}','2026-05-19T10:12:34Z');
`;
}

export const preservationSql = String.raw`select jsonb_build_object(
  'matter_items', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.matter_items t),
  'reading_sessions', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.reading_sessions t),
  'matter_tags', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.matter_tags t),
  'item_tags', (select coalesce(jsonb_agg(to_jsonb(t) order by item_id, tag_id), '[]'::jsonb) from public.item_tags t),
  'annotations', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.annotations t),
  'daily_stats', (select coalesce(jsonb_agg(to_jsonb(t) order by date), '[]'::jsonb) from public.daily_stats t),
  'sync_runs', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.sync_runs t),
  'sync_state', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.sync_state t),
  'counts', jsonb_build_object('items',(select count(*) from public.matter_items),'sessions',(select count(*) from public.reading_sessions),'tags',(select count(*) from public.matter_tags),'links',(select count(*) from public.item_tags),'annotations',(select count(*) from public.annotations),'daily',(select count(*) from public.daily_stats),'runs',(select count(*) from public.sync_runs),'sync_state',(select count(*) from public.sync_state)),
  'duration_total', (select sum(duration_seconds) from public.reading_sessions),
  'singleton', (select jsonb_build_object('count',(select count(*) from public.sync_state),'id',id,'ownership_marker',item_cursor) from public.sync_state where id='matter')
)::text;`;

export function assertLegacyPreserved(before, after) {
  assert.deepEqual(after, before, "upgrade changed legacy rows, identifiers, relationships, values, counts, duration, or singleton state");
}

export async function removeOwnedLegacySingleton({ query, ownershipMarker, runIntegration }) {
  const storedMarker = (await query("select item_cursor from public.sync_state where id = 'matter';")).trim();
  assert.equal(storedMarker, ownershipMarker, "legacy sync_state ownership is unexpected; refusing deletion");
  const removed = (await query(`delete from public.sync_state where id = 'matter' and item_cursor = '${ownershipMarker}' returning id;`)).trim();
  assert.equal(removed, "matter", "runner-owned sync_state singleton was not removed");
  const remaining = (await query("select count(*) from public.sync_state where id = 'matter';")).trim();
  assert.equal(remaining, "0", "runner-owned sync_state singleton remains after deletion");
  return runIntegration();
}

function containerPsql(projectId, sql, { quiet = true } = {}) {
  const flags = quiet ? "-XAtq" : "-XAt";
  return command("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", flags, "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "-"], { input: sql });
}

async function catalog(projectId, migrationsDir) {
  return verifyCatalog({
    databaseUrl: "container-local",
    migrationsDir,
    execute: (sql) => containerPsql(projectId, sql).split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
  });
}

function integrationEnvironment(status, projectId) {
  assert.ok(status.API_URL && status.ANON_KEY && status.SERVICE_ROLE_KEY, "Supabase status omitted required local credentials");
  return sanitizedEnvironment({
    DISPOSABLE_DB_ACK: "yes",
    STABILIZATION_TEST_SUPABASE_URL: status.API_URL,
    STABILIZATION_TEST_SUPABASE_ANON_KEY: status.ANON_KEY,
    STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    STABILIZATION_TEST_SQL_PROJECT: projectId,
  });
}

async function verifyPath({ name, workdir, projectId, upgrade }) {
  if (upgrade) await copyMigrations(workdir, (filename) => filename.slice(0, 14) <= UPGRADE_BASELINE);
  else await copyMigrations(workdir);
  cli(["start", "--workdir", workdir], { env: sanitizedEnvironment() });
  if (!upgrade) cli(["db", "reset", "--local", "--workdir", workdir], { env: sanitizedEnvironment() });
  let preservation = null;
  let streamPreservation = null;
  let leasePreservation = null;
  let pagePreservation = null;
  const ownershipMarker = `task05-${projectId}`;
  if (upgrade) {
    containerPsql(projectId, legacySeedSql(ownershipMarker));
    const before = containerPsql(projectId, preservationSql).trim();
    await copyMigrations(workdir, (filename) => filename.slice(0, 14) > UPGRADE_BASELINE && filename.slice(0, 14) < "20261005000000");
    cli(["migration", "up", "--local", "--workdir", workdir], { env: sanitizedEnvironment() });
    const streamSnapshotSql = "select jsonb_agg(to_jsonb(s) order by stream)::text from public.matter_sync_streams s;";
    const streamSeeds = JSON.parse(containerPsql(projectId, streamSnapshotSql));
    containerPsql(projectId, `update public.matter_sync_streams set cycle_active=true,
      cursor='${ownershipMarker}-' || stream, cycle_started_at='2026-10-01T00:00:00Z',
      cycle_generation=41, page_limit=17, completed_watermark='2026-09-01T00:00:00Z',
      retry_at='2099-01-01T00:00:00Z';`);
    const streamsBeforeLease = containerPsql(projectId, streamSnapshotSql);
    await copyMigrations(workdir, (filename) => filename.slice(0, 14) === "20261005000000");
    cli(["migration", "up", "--local", "--workdir", workdir], { env: sanitizedEnvironment() });
    assert.deepEqual(JSON.parse(containerPsql(projectId, streamSnapshotSql)), JSON.parse(streamsBeforeLease), "lease migration changed Task 11 active contracts, generations, watermarks or cooldowns");
    streamPreservation = "passed";
    const leaseOwner = "00000000-0000-4000-8000-000000000081";
    containerPsql(projectId, `update public.matter_sync_leases set owner='${leaseOwner}', generation=81, expires_at=clock_timestamp()+interval '120 seconds' where account_scope='matter';`);
    const task12SnapshotSql = "select jsonb_build_object('streams',(select jsonb_agg(to_jsonb(s) order by stream) from public.matter_sync_streams s),'leases',(select jsonb_agg(to_jsonb(l)) from public.matter_sync_leases l))::text;";
    const beforeTask13 = containerPsql(projectId, task12SnapshotSql);
    await copyMigrations(workdir, (filename) => filename.slice(0, 14) > "20261005000000" && filename.slice(0,14) <= "20261007085051");
    cli(["migration", "up", "--local", "--workdir", workdir], { env: sanitizedEnvironment() });
    assert.deepEqual(JSON.parse(containerPsql(projectId, task12SnapshotSql)), JSON.parse(beforeTask13), "Task 13 changed active Task 11 contracts, cooldowns or Task 12 lease generation/expiry");
    leasePreservation = "passed";
    const receiptId = "00000000-0000-4000-8000-000000000082";
    const dirtyRevision = "00000000-0000-4000-8000-000000000083";
    containerPsql(projectId, `insert into public.matter_page_receipts(stream,receipt_id,fingerprint) values ('recent_sessions','${receiptId}','owned-upgrade-receipt');
      insert into public.matter_dirty_rollups(date,revision,timezone) values ('2099-01-02','${dirtyRevision}','Europe/Athens');`);
    const task13SnapshotSql = "select jsonb_build_object('streams',(select jsonb_agg(to_jsonb(s) order by stream) from public.matter_sync_streams s),'leases',(select jsonb_agg(to_jsonb(l)) from public.matter_sync_leases l),'receipts',(select jsonb_agg(to_jsonb(r)) from public.matter_page_receipts r),'dirty',(select jsonb_agg(to_jsonb(d)) from public.matter_dirty_rollups d))::text;";
    const beforeTask14 = containerPsql(projectId,task13SnapshotSql);
    await copyMigrations(workdir,(filename) => filename.slice(0,14) > "20261007085051");
    cli(["migration","up","--local","--workdir",workdir],{env:sanitizedEnvironment()});
    assert.deepEqual(JSON.parse(containerPsql(projectId,task13SnapshotSql)),JSON.parse(beforeTask14),"Task 14 changed Task 11/12/13 contracts, cooldowns, leases, receipts or dirty work");
    pagePreservation = "passed";
    assert.equal(containerPsql(projectId, `select public.release_matter_sync_lease('matter','${leaseOwner}',81);`).trim(), "t");
    assert.equal(containerPsql(projectId,`delete from public.matter_page_receipts where receipt_id='${receiptId}' returning receipt_id;`).trim(),receiptId);
    assert.equal(containerPsql(projectId,`delete from public.matter_dirty_rollups where revision='${dirtyRevision}' returning revision;`).trim(),dirtyRevision);

    // Restore only the two synthetic contracts this path owns, after verifying
    // preservation. No unrelated row is overwritten for integration fixtures.
    for (const seed of streamSeeds) {
      const restored = containerPsql(projectId, `update public.matter_sync_streams
        set endpoint='${seed.endpoint}', filters='${JSON.stringify(seed.filters).replaceAll("'", "''")}'::jsonb,
          page_limit=${seed.page_limit}, cursor=null, cycle_started_at=null,
          cycle_generation=${seed.cycle_generation}, completed_watermark=null, retry_at=null,
          cycle_active=false, transition_status='${seed.transition_status}',
          coverage_window=${seed.coverage_window ? `'${seed.coverage_window}'` : "null"}
        where stream='${seed.stream}' and cursor='${ownershipMarker}-${seed.stream}' returning stream;`);
      assert.equal(restored.trim(), seed.stream, "synthetic stream ownership changed; refusing restoration");
    }
    const after = containerPsql(projectId, preservationSql).trim();
    assertLegacyPreserved(JSON.parse(before), JSON.parse(after));
    preservation = "passed";
  }
  const status = parseStatusEnv(cli(["status", "--workdir", workdir, "-o", "env"], { env: sanitizedEnvironment() }));
  const versions = await catalog(projectId, path.join(workdir, "supabase/migrations"));
  let leaseEvidence;
  let pageEvidence;
  let continuationEvidence;
  const runIntegration = () => {
    command(process.execPath, [path.join(repoRoot, "node_modules/typescript/bin/tsc"), "-p", "tests/tsconfig.json"], { env: sanitizedEnvironment() });
    const env = integrationEnvironment(status, projectId);
    command(process.execPath, [path.join(repoRoot, "tests/integration/supabase-security.mjs")], { env });
    const output = command(process.execPath, [path.join(repoRoot, "tests/integration/matter-sync-lease.mjs")], { env });
    const report = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.equal(report.status, "passed");
    assert.equal(report.realSqlAndDataApi, true);
    assert.equal(report.syntheticMatterOnly, true);
    assert.ok(Array.isArray(report.checks) && report.checks.every((check) => typeof check === "string"));
    // Copy only the integration report's known, credential-free evidence fields.
    leaseEvidence = { checks: report.checks, realSqlAndDataApi: true, syntheticMatterOnly: true };
    const pageOutput = command(process.execPath, [path.join(repoRoot, "tests/integration/matter-page-commit.mjs")], { env });
    const pageReport = JSON.parse(pageOutput.trim().split(/\r?\n/).at(-1));
    assert.equal(pageReport.status, "passed");
    assert.equal(pageReport.realSqlAndDataApi, true);
    assert.equal(pageReport.syntheticMatterOnly, true);
    assert.equal(pageReport.cleanup, "passed");
    pageEvidence = { checks: pageReport.checks, realSqlAndDataApi: true, syntheticMatterOnly: true, cleanup: "passed" };
    const continuationOutput = command(process.execPath, [path.join(repoRoot, "tests/integration/matter-continuation.mjs")], { env });
    const continuationReport = JSON.parse(continuationOutput.trim().split(/\r?\n/).at(-1));
    assert.equal(continuationReport.status, "passed");
    assert.equal(continuationReport.realSqlAndDataApi, true);
    assert.equal(continuationReport.syntheticMatterOnly, true);
    assert.equal(continuationReport.cleanup, "passed");
    continuationEvidence = { checks: continuationReport.checks, realSqlAndDataApi: true, syntheticMatterOnly: true, cleanup: "passed" };
  };
  if (upgrade) {
    await removeOwnedLegacySingleton({ query: (sql) => Promise.resolve(containerPsql(projectId, sql)), ownershipMarker, runIntegration });
  } else runIntegration();
  return { name, catalog: "passed", dataApi: "passed", accountLeaseSqlAndRuntime: "passed", leaseEvidence, atomicPageAndRollupRecovery: "passed", pageEvidence, boundedContinuationAndHistory: "passed", continuationEvidence, preservation, streamPreservation, leasePreservation, pagePreservation, migrationHistory: versions };
}

export async function runStabilizationDatabases({ evidenceRoot = path.join(repoRoot, "artifacts/stabilization-db"), hasDocker = dockerAvailable } = {}) {
  if (process.env.DISPOSABLE_DB_ACK !== "yes") throw new Error("Refusing to run without DISPOSABLE_DB_ACK=yes.");
  const sha = command("git", ["rev-parse", "HEAD"]).trim();
  const evidenceDir = path.join(evidenceRoot, sha);
  await mkdir(evidenceDir, { recursive: true });
  if (!hasDocker()) {
    const blocked = { status: "blocked", reason: "Docker-compatible runtime unavailable", gitSha: sha, realDatabaseVerification: false };
    await writeFile(path.join(evidenceDir, "blocked.json"), `${JSON.stringify(blocked, null, 2)}\n`);
    return blocked;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "matter-stats-db-"));
  const suffix = `${process.pid}-${Date.now().toString(36)}`;
  const stacks = [
    { name: "fresh", workdir: path.join(root, "fresh"), projectId: `matter-stats-fresh-${suffix}`, apiPort: 55421, dbPort: 55422, shadowPort: 55420, studioPort: 55423, inbucketPort: 55424, analyticsPort: 55427 },
    { name: "upgrade", workdir: path.join(root, "upgrade"), projectId: `matter-stats-upgrade-${suffix}`, apiPort: 56421, dbPort: 56422, shadowPort: 56420, studioPort: 56423, inbucketPort: 56424, analyticsPort: 56427 },
  ];
  const started = [];
  const cleanup = [];
  const results = [];
  let activePath = "configuration";
  let evidence;
  try {
    for (const stack of stacks) await configureStack(stack.workdir, stack);
    for (const stack of stacks) {
      activePath = stack.name;
      started.push(stack);
      results.push(await verifyPath({ ...stack, upgrade: stack.name === "upgrade" }));
    }
    evidence = { status: "passed", gitSha: sha, supabaseCli: SUPABASE_CLI_VERSION, paths: results, cleanup: "pending" };
    await writeFile(path.join(evidenceDir, "results.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    return evidence;
  } catch (error) {
    await writeFile(path.join(evidenceDir, "failure.json"), `${JSON.stringify({
      status: "failed",
      gitSha: sha,
      failedPath: activePath,
      paths: results,
      // Subprocess stderr can contain generated local credentials. Keep it in
      // the job diagnostic, never copy arbitrary error text into an artifact.
      message: "Disposable verification failed; see the workflow job log.",
      disposableDiagnostics: started.length ? disposableDiagnostics(started.at(-1).projectId) : [],
      cleanup: "pending",
    }, null, 2)}\n`);
    throw error;
  } finally {
    for (const stack of [...started].reverse()) {
      try {
        assertDisposableDirectory(stack.workdir);
        cli(["stop", "--workdir", stack.workdir, "--no-backup"], { env: sanitizedEnvironment() });
        cleanup.push({ path: stack.name, status: "stopped" });
      } catch {
        cleanup.push({ path: stack.name, status: "failed", error: "Disposable stack cleanup failed; see the workflow job log." });
      }
    }
    await rm(root, { recursive: true, force: true });
    await writeFile(path.join(evidenceDir, "cleanup.json"), `${JSON.stringify({ gitSha: sha, resources: cleanup, temporaryDirectoryRemoved: true }, null, 2)}\n`);
    if (cleanup.some(({ status }) => status === "failed")) throw new Error("One or more disposable stacks failed cleanup; see sanitized cleanup evidence.");
    if (evidence) {
      evidence.cleanup = "passed";
      await writeFile(path.join(evidenceDir, "results.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runStabilizationDatabases();
  if (result.status === "blocked") {
    console.error(`BLOCKED: ${result.reason}`);
    process.exitCode = 2;
  } else console.log(`Fresh and upgrade database verification passed for ${result.gitSha}.`);
}
