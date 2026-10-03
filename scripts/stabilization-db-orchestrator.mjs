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
  const keep = ["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP", "SystemRoot", "COMSPEC", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"];
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

const legacySeedSql = String.raw`
insert into public.matter_items (id,title,source,word_count,progress) values ('legacy-item','Legacy title','legacy.example',1200,0.5);
insert into public.reading_sessions (id,item_id,started_at,ended_at,duration_seconds,words_estimated) values ('legacy-session','legacy-item','2026-05-19T10:00:00Z','2026-05-19T10:12:34Z',754,2830);
insert into public.matter_tags (id,name) values ('legacy-tag','Legacy tag');
insert into public.item_tags (item_id,tag_id) values ('legacy-item','legacy-tag');
insert into public.annotations (id,item_id,text,note) values ('legacy-annotation','legacy-item','Legacy highlight','Legacy note');
insert into public.daily_stats (date,reading_time_seconds,words_read,sessions_count,items_read_count,highlights_count,top_source) values ('2026-05-19',754,2830,1,1,1,'legacy.example');
insert into public.sync_runs (id,status,items_synced,sessions_synced,annotations_synced,tags_synced) values ('00000000-0000-4000-8000-000000000059','complete',1,1,1,1);
insert into public.sync_state (id,active_phase,sync_mode,item_cursor,recent_activity_checkpoint) values ('matter','sessions','recent_activity','legacy-cursor','2026-05-19T10:12:34Z');
`;

const preservationSql = String.raw`select jsonb_build_object(
  'item', (select jsonb_build_object('id',id,'title',title,'source',source,'word_count',word_count,'progress',progress) from public.matter_items where id='legacy-item'),
  'session', (select jsonb_build_object('id',id,'item_id',item_id,'duration_seconds',duration_seconds,'words_estimated',words_estimated) from public.reading_sessions where id='legacy-session'),
  'tag_relation', (select jsonb_build_object('item_id',item_id,'tag_id',tag_id) from public.item_tags where item_id='legacy-item' and tag_id='legacy-tag'),
  'annotation', (select jsonb_build_object('id',id,'item_id',item_id,'text',text,'note',note) from public.annotations where id='legacy-annotation'),
  'daily', (select jsonb_build_object('date',date,'reading_time_seconds',reading_time_seconds,'words_read',words_read,'sessions_count',sessions_count,'items_read_count',items_read_count,'highlights_count',highlights_count) from public.daily_stats where date='2026-05-19'),
  'counts', jsonb_build_object('items',(select count(*) from public.matter_items),'sessions',(select count(*) from public.reading_sessions),'tags',(select count(*) from public.matter_tags),'links',(select count(*) from public.item_tags),'annotations',(select count(*) from public.annotations),'daily',(select count(*) from public.daily_stats),'runs',(select count(*) from public.sync_runs)),
  'duration_total', (select sum(duration_seconds) from public.reading_sessions),
  'sync_state', (select jsonb_build_object('count',(select count(*) from public.sync_state),'id',id,'active_phase',active_phase,'sync_mode',sync_mode,'item_cursor',item_cursor,'recent_activity_checkpoint',recent_activity_checkpoint) from public.sync_state where id='matter')
)::text;`;

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

function integrationEnvironment(status) {
  assert.ok(status.API_URL && status.ANON_KEY && status.SERVICE_ROLE_KEY, "Supabase status omitted required local credentials");
  return sanitizedEnvironment({
    DISPOSABLE_DB_ACK: "yes",
    STABILIZATION_TEST_SUPABASE_URL: status.API_URL,
    STABILIZATION_TEST_SUPABASE_ANON_KEY: status.ANON_KEY,
    STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  });
}

async function verifyPath({ name, workdir, projectId, upgrade }) {
  if (upgrade) await copyMigrations(workdir, (filename) => filename.slice(0, 14) <= UPGRADE_BASELINE);
  else await copyMigrations(workdir);
  cli(["start", "--workdir", workdir], { env: sanitizedEnvironment() });
  if (!upgrade) cli(["db", "reset", "--local", "--workdir", workdir], { env: sanitizedEnvironment() });
  let preservation = null;
  if (upgrade) {
    containerPsql(projectId, legacySeedSql);
    const before = containerPsql(projectId, preservationSql).trim();
    await copyMigrations(workdir, (filename) => filename.slice(0, 14) > UPGRADE_BASELINE);
    cli(["migration", "up", "--local", "--workdir", workdir], { env: sanitizedEnvironment() });
    const after = containerPsql(projectId, preservationSql).trim();
    assert.deepEqual(JSON.parse(after), JSON.parse(before), "upgrade changed legacy identifiers, relationships, values, counts, duration, or singleton state");
    preservation = "passed";
  }
  const status = parseStatusEnv(cli(["status", "--workdir", workdir, "-o", "env"], { env: sanitizedEnvironment() }));
  const versions = await catalog(projectId, path.join(workdir, "supabase/migrations"));
  command(process.execPath, [path.join(repoRoot, "tests/integration/supabase-security.mjs")], { env: integrationEnvironment(status) });
  return { name, catalog: "passed", dataApi: "passed", preservation, migrationHistory: versions };
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
  let evidence;
  try {
    for (const stack of stacks) await configureStack(stack.workdir, stack);
    const results = [];
    for (const stack of stacks) {
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
      message: String(error?.message ?? error).replaceAll(root, "<temporary-root>"),
      cleanup: "pending",
    }, null, 2)}\n`);
    throw error;
  } finally {
    for (const stack of [...started].reverse()) {
      try {
        assertDisposableDirectory(stack.workdir);
        cli(["stop", "--workdir", stack.workdir, "--no-backup"], { env: sanitizedEnvironment() });
        cleanup.push({ path: stack.name, status: "stopped" });
      } catch (error) {
        cleanup.push({ path: stack.name, status: "failed", error: error.message.replace(root, "<temporary-root>") });
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
