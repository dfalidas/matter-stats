#!/usr/bin/env node
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { executionIdentity, phaseRecorder, sanitizedEnvironment } from "./database-evidence.mjs";
import { rehearseRestore, restoreSnapshotSql, restoreTargetPreparationSql, restoreSourceRefusalSql, RESTORE_PHASES } from "./disposable-restore.mjs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { STATUS_TABLES } from "./matter-status-inventory.mjs";
import { GENERATION_TABLES } from "./reading-generation-inventory.mjs";
import { catalogCoverageProbesSql, repositoryMigrationVersions, verifyCatalog, INVENTORIED_FUNCTIONS, INVENTORIED_TABLES } from "./stabilization-db-runner.mjs";

export const SUPABASE_CLI_VERSION = "2.48.3";
export const UPGRADE_BASELINE = "20260519090000";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsSource = path.join(repoRoot, "supabase/migrations");
export const PRE_STATUS_TABLES = INVENTORIED_TABLES.filter(table => !STATUS_TABLES.includes(table));

export { sanitizedEnvironment } from "./database-evidence.mjs";

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

export function commandFailureCategory(stderr = '') {
  if (/no space left on device/i.test(stderr)) return 'disk-capacity';
  if (/failed to (?:pull|register layer)|pull.*(?:failed|denied)|toomanyrequests.*registry/i.test(stderr)) return 'image-pull';
  if (/timed? ?out|ETIMEDOUT|504 Gateway/i.test(stderr)) return 'timeout';
  if (/ECONNRESET|ECONNREFUSED|fetch failed|502 Bad Gateway/i.test(stderr)) return 'transport';
  if (/command not found|executable.*not found|ENOENT|npm ERR!|npm error/i.test(stderr)) return 'command-unavailable';
  return /AssertionError|ERR_ASSERTION/i.test(stderr) ? 'assertion' : 'execution';
}

export function command(binary, args, { cwd = repoRoot, env = sanitizedEnvironment(), input } = {}) {
  if (binary === "docker") args = ["--host=unix:///var/run/docker.sock", ...args];
  const result = spawnSync(binary, args, { cwd, env, input, encoding: "utf8", timeout: 20 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw Object.assign(new Error(`Disposable command unavailable or timed out (${result.error.code ?? 'unknown'}).`), { failureKind: "infrastructure", category:result.error.code === 'ETIMEDOUT' ? 'timeout' : 'command-unavailable' });
  if (result.status !== 0) {
    const category = commandFailureCategory(result.stderr);
    const databaseCode = result.stderr.match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/)?.[1] ?? null;
    const missingRelation = result.stderr.match(/relation "([a-z_][a-z0-9_.]{0,127})" does not exist/)?.[1] ?? null;
    const permissionReason = result.stderr.match(/must be owner of (?:schema|table|function|extension) [a-z_][a-z0-9_.]*|must be (?:able to SET ROLE|member of role) "[a-z_][a-z0-9_]*"|permission denied to set parameter "[a-z_][a-z0-9_]*"|permission denied for (?:schema|table|function) [a-z_][a-z0-9_.]*/)?.[0] ?? null;
    throw Object.assign(new Error(`Disposable ${path.basename(binary)} failed (exit ${result.status}; ${category}; SQLSTATE ${databaseCode ?? "unavailable"}; relation ${missingRelation ?? "unavailable"}; permission ${permissionReason ?? "unavailable"}). Raw output withheld.`), { failureKind: ['disk-capacity','image-pull','timeout','transport','command-unavailable'].includes(category) ? 'infrastructure' : 'assertion-or-suite', category, databaseCode, missingRelation, permissionReason });
  }
  return result.stdout;
}

export function cli(args, options) {
  return command("npx", ["--yes", `supabase@${SUPABASE_CLI_VERSION}`, ...args], options);
}

function dockerAvailable() {
  const executable = process.platform === "win32" ? "docker.exe" : "docker";
  const result = spawnSync(executable, ["--host=unix:///var/run/docker.sock", "info"], { timeout:30000, encoding: "utf8", env: sanitizedEnvironment() });
  return { available: !result.error && result.status === 0,
    reason: result.error?.code === 'ETIMEDOUT' ? 'Docker info timed out after 30 seconds' : 'Docker-compatible local runtime unavailable' };
}

// Failure-only disposable diagnostics. Never retain raw logs, environment,
// container identifiers or generated local credentials in evidence artifacts.
function disposableDiagnostics(projectId) {
  return ["kong", "rest", "db"].map((component) => {
    const container = `supabase_${component}_${projectId}`;
    const options = { encoding:"utf8", env:sanitizedEnvironment(), timeout:5000, maxBuffer:1024*1024 };
    const inspected = spawnSync("docker",["--host=unix:///var/run/docker.sock","inspect","--format","{{json .State}}",container],options);
    let state;
    try { state=JSON.parse(inspected.stdout); } catch { /* unavailable remains explicit */ }
    const logged = spawnSync("docker",["--host=unix:///var/run/docker.sock","logs","--tail","500",container],options);
    const lines = `${logged.stdout ?? ""}\n${logged.stderr ?? ""}`.split(/\r?\n/);
    return {
      component,
      stateAvailable:inspected.status===0 && Boolean(state),
      running:state?.Running===true,
      outOfMemory:state?.OOMKilled===true,
      exitCode:Number.isInteger(state?.ExitCode)?state.ExitCode:null,
      logsAvailable:logged.status===0,
      errorCounts:{
        upstream:lines.filter((line)=>/upstream.*(?:invalid|timed out|closed|refused|error)|(?:invalid|failed|reset|closed).*upstream|no live upstream/i.test(line)).length,
        connectionReset:lines.filter((line)=>/connection reset by peer|recv\(\) failed|upstream prematurely closed|upstream sent invalid/i.test(line)).length,
        processCrash:lines.filter((line)=>/segmentation|SIGSEGV|SIGABRT|panic|terminated by signal|exited on signal/i.test(line)).length,
        databaseError:lines.filter((line)=>/\b(?:ERROR|FATAL|PANIC):/.test(line)).length,
        workerConnections:lines.filter((line)=>/worker_connections|too many open files/i.test(line)).length,
        databaseConnections:lines.filter((line)=>/too many clients|remaining connection slots|connection pool.*(?:timeout|exhaust)/i.test(line)).length,
        postgrest:lines.filter((line)=>/PGRST[0-9]{3}/.test(line)).length,
      },
    };
  });
}

export async function configureStack(workdir, { projectId, apiPort, dbPort, shadowPort, studioPort, inbucketPort, analyticsPort }) {
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

export async function copyMigrations(workdir, predicate = () => true) {
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
  'reading_sessions', (select coalesce(jsonb_agg(to_jsonb(t) - 'word_estimation_method' order by id), '[]'::jsonb) from public.reading_sessions t),
  'matter_tags', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.matter_tags t),
  'item_tags', (select coalesce(jsonb_agg(to_jsonb(t) order by item_id, tag_id), '[]'::jsonb) from public.item_tags t),
  'annotations', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.annotations t),
  'daily_stats', (select coalesce(jsonb_agg(to_jsonb(t) - 'reading_provenance' order by date), '[]'::jsonb) from public.daily_stats t),
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

export function containerPsql(projectId, sql, { quiet = true } = {}) {
  const flags = quiet ? "-XAtq" : "-XAt";
  return command("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", flags, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres", "-f", "-"], { input: sql });
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

export function configureDisposableGateway(projectId) {
  assert.match(projectId, /^matter-stats-(fresh|upgrade|restore)-[a-z0-9-]+$/);
  // The CLI's Kong can reuse a socket closed by its upstream under the large
  // fixture's burst of real Data API calls. Disable only this owned gateway's
  // connection reuse, using Kong's supported setting. No retry or auth bypass.
  const gateway = `supabase_kong_${projectId}`;
  command("docker", ["exec", "-e", "KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0", gateway,
    "kong", "reload", "--nginx-conf", "/home/kong/custom_nginx.template"]);
  const setting = command("docker", ["exec", gateway, "sh", "-c",
    "sed -n '/^upstream_keepalive_pool_size *=/p' /usr/local/kong/.kong_env"]);
  assert.match(setting.trim(), /^upstream_keepalive_pool_size\s*=\s*0$/,
    "owned gateway did not retain the supported transport setting");
  return { upstreamKeepalivePoolSize: 0, configuration: "verified", scope: "owned-disposable-only" };
}

export const DATABASE_PHASES = ['migrations-preservation', 'gateway', 'catalog', 'security', 'lease', 'page', 'word-method', 'continuation', 'requests', 'preview', 'status', 'repair'];

async function verifyPath({ name, workdir, projectId, upgrade, phases, evidenceDir, beforeIntegration }) {
  if (upgrade) await copyMigrations(workdir, (filename) => filename.slice(0, 14) <= UPGRADE_BASELINE);
  else await copyMigrations(workdir);
  cli(["start", "--workdir", workdir], { env: sanitizedEnvironment() });
  if (!upgrade && !beforeIntegration) cli(["db", "reset", "--local", "--workdir", workdir], { env: sanitizedEnvironment() });
  let preservation = null;
  let streamPreservation = null;
  let leasePreservation = null;
  let pagePreservation = null;
  let generationPreservation = "not applicable";
  let statusPreservation = "not applicable";
  let requestPreservation = null;
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
    await copyMigrations(workdir,(filename) => filename.slice(0,14) > "20261007085051" && filename.slice(0,14) < "20261008000000");
    cli(["migration","up","--local","--workdir",workdir],{env:sanitizedEnvironment()});
    assert.deepEqual(JSON.parse(containerPsql(projectId,task13SnapshotSql)),JSON.parse(beforeTask14),"Task 14 changed Task 11/12/13 contracts, cooldowns, leases, receipts or dirty work");
    pagePreservation = "passed";
    const task14SnapshotSql = "select jsonb_build_object('prior',("+task13SnapshotSql.replace(/;$/,"")+"),'intent',(select to_jsonb(c) from public.matter_sync_continuation c))::text;";
    const beforeTask15 = containerPsql(projectId,task14SnapshotSql);
    await copyMigrations(workdir,(filename)=>filename.slice(0,14)>="20261008000000" && filename.slice(0,14)<"20261014140402");
    cli(["migration","up","--local","--workdir",workdir],{env:sanitizedEnvironment()});
    assert.deepEqual(JSON.parse(containerPsql(projectId,task14SnapshotSql)),JSON.parse(beforeTask15),"Task 15 changed Task 11–14 durable state");
    requestPreservation="passed";
    // Genuine Task 19 -> Task 20 upgrade: retain known provenance plus all source/progress fields.
    const upgradeId=`task20-upgrade-${ownershipMarker}`;
    assert.equal(containerPsql(projectId,"select count(*) from public.daily_stats where date='2098-12-31';").trim(),"0");
    containerPsql(projectId,`insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated,word_estimation_method,source_device)
      values('${upgradeId}','2098-12-31T10:00:00Z',60,225,'session-duration-225-round-v1','owned-upgrade');
      insert into public.daily_stats(date,reading_time_seconds,words_read,sessions_count,items_read_count,highlights_count,top_source,reading_provenance)
      values('2098-12-31',60,225,1,19,20,'owned-upgrade.example','{"wordMethod":"session-duration-225-round-v1","calendarMethod":"local-occurrence-day-v1","timezone":"Europe/Athens"}');`);
    const task19SnapshotSql=PRE_STATUS_TABLES.filter(t=>!GENERATION_TABLES.includes(t)).map(t=>`select jsonb_build_object('table','${t}','count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')))::text from public.${t} r;`).join("\n");
    const beforeTask20=containerPsql(projectId,task19SnapshotSql);
    await copyMigrations(workdir,filename=>filename.slice(0,14)>="20261014140402" && filename.slice(0,14)<"20261015141435");
    cli(["migration","up","--local","--workdir",workdir],{env:sanitizedEnvironment()});
    assert.equal(containerPsql(projectId,task19SnapshotSql),beforeTask20,"Task 20 migration changed Task 19/source/provenance/progress fields");
    assert.equal(containerPsql(projectId,"select count(*) from public.reading_generations;").trim(),"0");
    assert.equal(containerPsql(projectId,"select active is null and building is null and frozen is null and epoch=0 from public.reading_generation_control;").trim(),"t");
    assert.equal(containerPsql(projectId,`delete from public.reading_sessions where id='${upgradeId}' and source_device='owned-upgrade' returning id;`).trim(),upgradeId);
    assert.equal(containerPsql(projectId,"delete from public.daily_stats where date='2098-12-31' and top_source='owned-upgrade.example' returning date;").trim(),"2098-12-31");
    generationPreservation="passed";
    // Genuine Task 20 -> 21 upgrade. Observe every already-installed source,
    // derived generation and ingestion-control table, without inventing event times.
    const task20SnapshotSql=PRE_STATUS_TABLES.map(t=>`select jsonb_build_object('table','${t}','count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')))::text from public.${t} r;`).join("\n");
    const beforeTask21=containerPsql(projectId,task20SnapshotSql);
    await copyMigrations(workdir,filename=>filename.slice(0,14)>="20261015141435");
    cli(["migration","up","--local","--workdir",workdir],{env:sanitizedEnvironment()});
    assert.equal(containerPsql(projectId,task20SnapshotSql),beforeTask21,"Task 21 changed existing Task 20/source/progress/generation state");
    assert.equal(containerPsql(projectId,"select count(*) from public.matter_cycle_completions;").trim(),"0");
    assert.equal(containerPsql(projectId,"select count(*) from public.matter_invocation_status;").trim(),"0");
    statusPreservation="passed";

    // Only this disposable path owns the synthetic 2099 quota seed copied
    // from its pre-upgrade stream fixture; clear it after verifying preservation.
    containerPsql(projectId,"update public.matter_quota set not_before=null where account_scope='matter';");
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
  if (upgrade) assert.equal(containerPsql(projectId, "select count(*) from public.reading_sessions where id='legacy-session' and word_estimation_method is null;").trim(), "1");
  if (upgrade) assert.equal(containerPsql(projectId, "select count(*) from public.daily_stats where date='2026-05-19' and reading_provenance is null;").trim(), "1");
  phases.end();
  phases.begin(`${name}:gateway`);
  const gatewayTransport = configureDisposableGateway(projectId);
  let status = parseStatusEnv(cli(["status", "--workdir", workdir, "-o", "env"], { env: sanitizedEnvironment() }));
  phases.end();
  phases.begin(`${name}:catalog`);
  containerPsql(projectId, catalogCoverageProbesSql());
  const versions = await catalog(projectId, path.join(workdir, "supabase/migrations"));
  writeFileSync(path.join(evidenceDir, `${name}-migrations.json`), JSON.stringify({status:'passed', migrationHistory:versions},null,2)+'\n');
  const retainSuite = (suite, report) => writeFileSync(path.join(evidenceDir, `${name}-${suite}.json`), JSON.stringify(report,null,2)+'\n');
  phases.end();
  if (beforeIntegration) status = await beforeIntegration();
  let leaseEvidence;
  let pageEvidence;
  let continuationEvidence;
  let requestEvidence;
  let previewEvidence;
  let wordMethodEvidence;
  let repairEvidence;
  let statusEvidence;
  const runIntegration = () => {
    const env = integrationEnvironment(status, projectId);
    phases.begin(`${name}:security`);
    const securityOutput = command(process.execPath, [path.join(repoRoot, "tests/integration/supabase-security.mjs")], { env });
    const securityReport = JSON.parse(securityOutput.trim().split(/\r?\n/).at(-1));
    assert.equal(securityReport.status, 'passed');
    assert.equal(securityReport.cleanup, 'passed');
    retainSuite('security', {status:'passed',fixtures:securityReport.fixtures,limiterGroups:securityReport.limiterGroups,requestsPerGroup:securityReport.requestsPerGroup,cleanup:'passed'});
    phases.end();
    phases.begin(`${name}:lease`);
    const output = command(process.execPath, [path.join(repoRoot, "tests/integration/matter-sync-lease.mjs")], { env });
    const report = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.equal(report.status, "passed");
    assert.equal(report.realSqlAndDataApi, true);
    assert.equal(report.syntheticMatterOnly, true);
    assert.ok(Array.isArray(report.checks) && report.checks.every((check) => typeof check === "string"));
    // Copy only the integration report's known, credential-free evidence fields.
    leaseEvidence = { checks: report.checks, realSqlAndDataApi: true, syntheticMatterOnly: true };
    retainSuite('lease', {status:'passed',...leaseEvidence});
    phases.end();
    phases.begin(`${name}:page`);
    const pageOutput = command(process.execPath, [path.join(repoRoot, "tests/integration/matter-page-commit.mjs")], { env });
    const pageReport = JSON.parse(pageOutput.trim().split(/\r?\n/).at(-1));
    assert.equal(pageReport.status, "passed");
    assert.equal(pageReport.realSqlAndDataApi, true);
    assert.equal(pageReport.syntheticMatterOnly, true);
    assert.equal(pageReport.cleanup, "passed");
    pageEvidence = { checks: pageReport.checks, realSqlAndDataApi: true, syntheticMatterOnly: true, cleanup: "passed" };
    retainSuite('page', {status:'passed',...pageEvidence});
    phases.end();
    phases.begin(`${name}:word-method`);
    const wordMethodOutput=command(process.execPath,[path.join(repoRoot,"tests/integration/session-word-method.mjs")],{env});
    const wordMethodReport=JSON.parse(wordMethodOutput.trim().split(/\r?\n/).at(-1));
    assert.equal(wordMethodReport.status,"passed");assert.equal(wordMethodReport.realSqlAndDataApi,true);assert.equal(wordMethodReport.cleanup,"passed");
    assert.deepEqual(wordMethodReport.range,{start:0,endInclusive:600,rows:601,committedPages:7,rejectedPages:10});
    wordMethodEvidence={checks:wordMethodReport.checks,range:wordMethodReport.range,boundaries:wordMethodReport.boundaries,realSqlAndDataApi:true,cleanup:"passed"};
    retainSuite('word-method', {status:'passed',...wordMethodEvidence});
    phases.end();
    phases.begin(`${name}:continuation`);
    const continuationOutput = command(process.execPath, [path.join(repoRoot, "tests/integration/matter-continuation.mjs")], { env });
    const continuationReport = JSON.parse(continuationOutput.trim().split(/\r?\n/).at(-1));
    assert.equal(continuationReport.status, "passed");
    assert.equal(continuationReport.realSqlAndDataApi, true);
    assert.equal(continuationReport.syntheticMatterOnly, true);
    assert.equal(continuationReport.cleanup, "passed");
    const referenceFields = ["count","distinct","mismatches","wordMismatches","duration","referenceDuration","sessionPages","invocations"];
    assert.ok(referenceFields.every((field)=>Number.isSafeInteger(continuationReport.historyReference?.[field]) && continuationReport.historyReference[field]>=0));
    continuationEvidence = { checks: continuationReport.checks,
      historyReference:Object.fromEntries(referenceFields.map((field)=>[field,continuationReport.historyReference[field]])),
      realSqlAndDataApi: true, syntheticMatterOnly: true, cleanup: "passed" };
    retainSuite('continuation', {status:'passed',...continuationEvidence});
    phases.end();
    phases.begin(`${name}:requests`);
    const requestOutput = command(process.execPath,[path.join(repoRoot,"tests/integration/matter-requests.mjs")],{env});
    const requestReport=JSON.parse(requestOutput.trim().split(/\r?\n/).at(-1));
    assert.equal(requestReport.status,"passed"); assert.equal(requestReport.realSqlAndDataApi,true); assert.equal(requestReport.cleanup,"passed");
    requestEvidence={checks:requestReport.checks,realSqlAndDataApi:true,syntheticMatterOnly:true,cleanup:"passed"};
    retainSuite('requests', {status:'passed',...requestEvidence});
    phases.end();
    phases.begin(`${name}:preview`);
    const previewOutput=command(process.execPath,[path.join(repoRoot,"tests/integration/historical-preview.mjs")],{env});
    const previewReport=JSON.parse(previewOutput.trim().split(/\r?\n/).at(-1));
    assert.equal(previewReport.status,"passed");assert.equal(previewReport.realSql,true);assert.equal(previewReport.cleanup,"passed");
    previewEvidence={checks:previewReport.checks,realSql:true,syntheticOnly:true,cleanup:"passed"};
    retainSuite('preview', {status:'passed',...previewEvidence});
    phases.end();
    phases.begin(`${name}:status`);
    const statusOutput=command(process.execPath,[path.join(repoRoot,"tests/integration/matter-status.mjs")],{env});
    const statusReport=JSON.parse(statusOutput.trim().split(/\r?\n/).at(-1));
    statusEvidence={status:statusReport.status,checks:statusReport.checks,realSqlAndDataApi:statusReport.realSqlAndDataApi,cleanup:statusReport.cleanup};
    assert.equal(statusEvidence.status,"passed");assert.equal(statusEvidence.realSqlAndDataApi,true);assert.equal(statusEvidence.cleanup,"passed");
    retainSuite('status', {status:'passed',...statusEvidence});
    phases.end();
    phases.begin(`${name}:repair`);
    const repairOutput=command(process.execPath,[path.join(repoRoot,"tests/integration/historical-repair.mjs")],{env});
    const repairReport=JSON.parse(repairOutput.trim().split(/\r?\n/).at(-1));
    assert.equal(repairReport.status,"passed");assert.equal(repairReport.realSqlAndDataApi,true);assert.equal(repairReport.cleanup,"passed");
    assert.ok(repairReport.reference.sessions>10000);
    repairEvidence={checks:repairReport.checks,checkCounts:repairReport.checkCounts,reference:repairReport.reference,afterIngestion:repairReport.afterIngestion,reconciliation:repairReport.reconciliation,boundaryCases:repairReport.boundaryCases,range:repairReport.range,browserDenials:repairReport.browserDenials,realSqlAndDataApi:true,syntheticOnly:true,cleanup:"passed"};

    retainSuite('repair', {status:'passed',...repairEvidence});
    phases.end();
  };
  if (upgrade) {
    await removeOwnedLegacySingleton({ query: (sql) => Promise.resolve(containerPsql(projectId, sql)), ownershipMarker, runIntegration });
  } else runIntegration();
  return { name, catalog: "passed", dataApi: "passed", gatewayTransport, accountLeaseSqlAndRuntime: "passed", leaseEvidence, atomicPageAndRollupRecovery: "passed", pageEvidence, boundedContinuationAndHistory: "passed", continuationEvidence, sharedQuotaAndRetries:"passed", requestEvidence, historicalPreview:"passed", previewEvidence, sessionWordMethod:"passed", wordMethodEvidence, historicalRepair:"passed", repairEvidence, truthfulStatus:"passed", statusEvidence, statusPreservation, generationPreservation, requestPreservation, preservation, streamPreservation, leasePreservation, pagePreservation, migrationHistory: versions };
}

export async function runStabilizationDatabases({ evidenceRoot = path.join(repoRoot, "artifacts/stabilization-db"), hasDocker = dockerAvailable, getIdentity = executionIdentity } = {}) {
  if (process.env.DISPOSABLE_DB_ACK !== "yes") throw new Error("Refusing to run without DISPOSABLE_DB_ACK=yes.");
  const identity = getIdentity();
  const sha = identity.testedSha;
  const evidenceDir = path.join(evidenceRoot, sha);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, 'repository-inventory.json'), JSON.stringify({
    migrationVersions:await repositoryMigrationVersions(migrationsSource), tables:INVENTORIED_TABLES, views:[], functions:INVENTORIED_FUNCTIONS,
  },null,2)+'\n');
  const phaseNames = ['toolchain', 'compilation', 'configuration', ...DATABASE_PHASES.slice(0,3).map(phase=>`fresh:${phase}`), 'backup-restore', ...DATABASE_PHASES.slice(3).map(phase=>`fresh:${phase}`), ...DATABASE_PHASES.map(phase=>`upgrade:${phase}`), 'cleanup'];
  let announcedPhase;
  const phases = phaseRecorder(phaseNames, data => {
    writeFileSync(path.join(evidenceDir, 'outcomes.json'), JSON.stringify({ ...identity, ...data }, null, 2) + '\n');
    const running = data.steps.find(step => step.status === 'running')?.name;
    if (running && running !== announcedPhase) { console.log(`Disposable verification phase: ${running}`); announcedPhase = running; }
  });
  await writeFile(path.join(evidenceDir, 'identity.json'), JSON.stringify(identity, null, 2) + '\n');
  phases.begin('toolchain');
  const dockerProbe = hasDocker();
  if (!(typeof dockerProbe === 'boolean' ? dockerProbe : dockerProbe.available)) {
    phases.fail('infrastructure');
    const blocked = { status: "blocked", reason: typeof dockerProbe === 'boolean' ? 'Docker-compatible runtime unavailable' : dockerProbe.reason, gitSha: sha, realDatabaseVerification: false };
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
  const persistCleanup = temporaryDirectoryRemoved => writeFileSync(path.join(evidenceDir, 'cleanup.json'), JSON.stringify({ gitSha:sha, resources:cleanup, temporaryDirectoryRemoved }, null, 2)+'\n');
  persistCleanup(false);
  const registerStack = stack => {
    assert.equal(command('docker',['ps','-a','--filter',`name=_${stack.projectId}$`,'--format','{{.Names}}']).trim(), '', 'refusing existing stack containers');
    assert.equal(command('docker',['volume','ls','--filter',`name=_${stack.projectId}$`,'--format','{{.Name}}']).trim(), '', 'refusing existing stack volumes');
    assert.equal(command('docker',['network','ls','--filter',`name=_${stack.projectId}$`,'--format','{{.Name}}']).trim(), '', 'refusing existing stack networks');
    started.push(stack); cleanup.push({path:stack.name,status:'pending'}); persistCleanup(false); };
  const stopStack = (stack, record = true) => {
    assertDisposableDirectory(stack.workdir);
    cli(['stop','--workdir',stack.workdir,'--no-backup']);
    for (const [resource, args] of [['containers',['ps','-a']],['volumes',['volume','ls']],['networks',['network','ls']]]) {
      assert.equal(command('docker',[...args,'--filter',`name=_${stack.projectId}$`,'--format',resource==='containers'?'{{.Names}}':'{{.Name}}']).trim(), '', `owned ${resource} remain after stop`);
    }
    stack.stopped = true;
    cleanup.find(row => row.path===stack.name).status='verified-removed';
    if (record) persistCleanup(false);
  };
  let activePath = "configuration";
  let evidence;
  let failureEvidence;
  let restoreProgress;
  try {
    const actualCli = cli(['--version']).trim();
    assert.equal(actualCli, SUPABASE_CLI_VERSION, 'unexpected Supabase CLI version');
    await writeFile(path.join(evidenceDir, 'toolchain.json'), JSON.stringify({ node:identity.node, npm:identity.npm, supabaseCli:actualCli }, null, 2) + '\n');
    phases.end();
    phases.begin('compilation');
    command(process.execPath, [path.join(repoRoot, 'node_modules/typescript/bin/tsc'), '-p', 'tests/tsconfig.json']);
    phases.end();
    phases.begin('configuration');
    for (const stack of stacks) await configureStack(stack.workdir, stack);
    phases.end();
    const verifyRestoreBeforeFresh = async () => {
      activePath = "backup-restore";
      phases.begin('backup-restore');
      restoreProgress = phaseRecorder(['source-rejection', 'target', ...RESTORE_PHASES, 'source-reset'], data => writeFileSync(path.join(evidenceDir,'backup-restore-outcomes.json'), JSON.stringify(data,null,2)+'\n'));
      restoreProgress.begin('source-rejection');
      containerPsql(stacks[0].projectId, restoreSourceRefusalSql);
      restoreProgress.end();
      restoreProgress.begin('target');
      const restoreStack = { ...stacks[0], name:'restore', projectId:`matter-stats-restore-${suffix}`, workdir:path.join(root,'restore'), apiPort:57421, dbPort:57422, shadowPort:57420, studioPort:57423, inbucketPort:57424, analyticsPort:57427 };
      await configureStack(restoreStack.workdir, restoreStack);
      registerStack(restoreStack);
      cli(['start','--workdir',restoreStack.workdir]);
      restoreProgress.end();
      const restoreEvidence = await rehearseRestore({
        source: stacks[0].projectId, target: restoreStack.projectId, progress:restoreProgress,
        sql: containerPsql,
        dump: project => {
          assert.equal(project, stacks[0].projectId);
          const local = ['--local','--workdir',stacks[0].workdir];
          // Use the reviewed CLI's native project-role filters. The default
          // schema export excludes managed schemas; this app owns public only.
          const schema = cli(['db','dump',...local,'--keep-comments']);
          const historySchema = cli(['db','dump',...local,'--schema','supabase_migrations','--keep-comments']);
          const data = cli(['db','dump',...local,'--schema','public,supabase_migrations','--data-only','--use-copy']);
          return `${schema}\n${historySchema}\n${data}`;
        },
        restore: (project, backup) => {
          assert.equal(project, restoreStack.projectId, 'refusing an unowned restore target');
          return containerPsql(project, `begin;\n${restoreTargetPreparationSql}\n${backup}\ncommit;\nnotify pgrst, 'reload schema';`);
        },
        verifyCatalog: project => catalog(project, migrationsSource),
        verifyDataApi: project => {
          configureDisposableGateway(project);
          const status = parseStatusEnv(cli(['status','--workdir',restoreStack.workdir,'-o','env']));
          const before = containerPsql(project, restoreSnapshotSql);
          const output = command(process.execPath, [path.join(repoRoot,'tests/integration/supabase-restored.mjs')], { env:integrationEnvironment(status, project) });
          const report = JSON.parse(output.trim().split(/\r?\n/).at(-1));
          assert.equal(report.status, 'passed');
          assert.equal(report.cleanup, 'passed');
          assert.equal(containerPsql(project, restoreSnapshotSql), before, 'restore Data API controls changed app data/progress');
        },
      });
      stopStack(restoreStack);
      restoreProgress.begin('source-reset');
      cli(['db','reset','--local','--workdir',stacks[0].workdir]);
      configureDisposableGateway(stacks[0].projectId);
      await catalog(stacks[0].projectId, migrationsSource);
      const refreshedStatus = parseStatusEnv(cli(['status','--workdir',stacks[0].workdir,'-o','env']));
      restoreProgress.end();
      phases.end();
      await writeFile(path.join(evidenceDir,'backup-restore.json'), JSON.stringify(restoreEvidence,null,2)+'\n');
      activePath = "fresh";
      return refreshedStatus;
    };
    for (const stack of stacks) {
      activePath = stack.name;
      phases.begin(`${stack.name}:migrations-preservation`);
      registerStack(stack);
      results.push(await verifyPath({ ...stack, upgrade: stack.name === "upgrade", phases, evidenceDir, beforeIntegration: stack.name === "fresh" ? verifyRestoreBeforeFresh : undefined }));
    }
    evidence = { status: "passed", gitSha: sha, supabaseCli: SUPABASE_CLI_VERSION, paths: results, cleanup: "pending" };
    await writeFile(path.join(evidenceDir, "results.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    return evidence;
  } catch (error) {
    phases.fail(error.failureKind);
    restoreProgress?.fail(error.failureKind);
    if (activePath === 'backup-restore' && started.length) {
      let metadata = {available:false};
      try {
        metadata = JSON.parse(containerPsql(started.at(-1).projectId, `select jsonb_build_object(
          'available',true,'role',current_user,'sessionRole',session_user,
          'databaseOwner',(select pg_get_userbyid(datdba) from pg_database where datname=current_database()),
          'schemas',(select jsonb_object_agg(nspname,pg_get_userbyid(nspowner)) from pg_namespace where nspname in ('public','supabase_migrations')),
          'tables',(select coalesce(jsonb_object_agg(n.nspname || '.' || c.relname,pg_get_userbyid(c.relowner)),'{}') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','supabase_migrations') and c.relkind in ('r','p'))
        )::text;`));
      } catch { /* preserve primary failure; diagnostic unavailability is explicit */ }
      await writeFile(path.join(evidenceDir,'restore-target-metadata.json'),JSON.stringify(metadata,null,2)+'\n');
    }
    failureEvidence = {
      status: "failed",
      gitSha: sha,
      failedPath: activePath,
      failureKind: error.failureKind ?? "assertion-or-suite",
      category: error.category ?? "assertion-or-execution",
      databaseCode: error.databaseCode ?? null,
      missingRelation: error.missingRelation ?? null,
      permissionReason: error.permissionReason ?? null,
      paths: results,
      // Subprocess stderr can contain generated local credentials. Raw child
      // output is withheld; retain only known classifications and phase results.
      message: "Disposable verification failed; consult phase outcomes and sanitized diagnostics.",
      disposableDiagnostics: started.length ? disposableDiagnostics(started.at(-1).projectId) : [],
      cleanup: "pending",
    };
    await writeFile(path.join(evidenceDir, "failure.json"), `${JSON.stringify(failureEvidence, null, 2)}\n`);
    throw error;
  } finally {
    // Evidence I/O (including ENOSPC) must never prevent owned cleanup.
    let cleanupEvidenceFailed = false;
    try { phases.begin('cleanup'); } catch { cleanupEvidenceFailed = true; }
    for (const stack of [...started].reverse().filter(stack => !stack.stopped)) {
      try {
        stopStack(stack, false);
      } catch {
        cleanup.find(row => row.path===stack.name).status="failed";
      }
    }
    let temporaryDirectoryRemoved = false;
    try { if (!cleanup.some(row => row.status === "failed")) { await rm(root, { recursive: true, force: true }); temporaryDirectoryRemoved = true; } }
    catch { cleanup.push({ path:'temporary-directory', status:'failed' }); }
    try {
      await writeFile(path.join(evidenceDir, "cleanup.json"), `${JSON.stringify({ gitSha: sha, resources: cleanup, temporaryDirectoryRemoved }, null, 2)}\n`);
    } catch { cleanupEvidenceFailed = true; }
    const cleanupFailed = cleanup.some(({ status }) => status === "failed");
    if (failureEvidence) {
      failureEvidence.cleanup = cleanupFailed ? 'failed' : 'passed';
      try { await writeFile(path.join(evidenceDir, 'failure.json'), JSON.stringify(failureEvidence,null,2)+'\n'); } catch { cleanupEvidenceFailed = true; }
    }
    if (cleanupFailed || cleanupEvidenceFailed) {
      try { phases.fail('infrastructure'); } catch { /* disk unavailable; cleanup was still attempted */ }
      if (evidence) {
        evidence.status='failed'; evidence.cleanup='failed';
        try { await writeFile(path.join(evidenceDir,'results.json'), JSON.stringify(evidence,null,2)+'\n'); } catch { /* evidence remains unverified */ }
      }
      throw new Error('Owned cleanup or retention of its evidence failed; do not infer successful cleanup.');
    }
    phases.end();
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
