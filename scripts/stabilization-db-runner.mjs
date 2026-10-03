#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

export const CLI_VERSION = "2.119.0";
export const BASELINE_VERSION = "20260519090000";
export const ACKNOWLEDGEMENT = "I_ACKNOWLEDGE_THIS_CREATES_AND_DESTROYS_ONLY_DISPOSABLE_LOCAL_STACKS";
export const TABLES = ["matter_items", "reading_sessions", "matter_tags", "item_tags", "annotations", "daily_stats", "sync_runs", "sync_state", "app_sessions", "app_login_attempts"];

export function assertSafeInvocation(env) {
  assert.equal(env.STABILIZATION_TEST_DISPOSABLE_ACK, ACKNOWLEDGEMENT,
    `Refusing to run without STABILIZATION_TEST_DISPOSABLE_ACK=${ACKNOWLEDGEMENT}`);
  for (const forbidden of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_ID", "SUPABASE_DB_PASSWORD"]) {
    assert.ok(!env[forbidden], `Refusing to run while remote-link variable ${forbidden} is set`);
  }
}

export function sanitizedEnvironment(base, credentials) {
  const env = { PATH: base.PATH, HOME: base.HOME, TMPDIR: base.TMPDIR, NODE_ENV: "test", SUPABASE_TELEMETRY_DISABLED: "1" };
  return {
    ...env,
    DISPOSABLE_DB_ACK: "yes",
    STABILIZATION_TEST_SUPABASE_URL: credentials.API_URL,
    STABILIZATION_TEST_SUPABASE_ANON_KEY: credentials.ANON_KEY,
    STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY: credentials.SERVICE_ROLE_KEY,
  };
}

export async function settleAndCleanup(work, cleanup) {
  let primary;
  try { await work(); } catch (error) { primary = error; }
  let cleanupError;
  try { await cleanup(); } catch (error) { cleanupError = error; }
  if (primary && cleanupError) throw new AggregateError([primary, cleanupError], "verification and cleanup both failed");
  if (primary) throw primary;
  if (cleanupError) throw cleanupError;
}

async function run(command, args, { cwd, env = process.env, input, sensitive = false } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(new Error(`Unable to start ${command}: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(
      `${command} ${args.filter((arg) => !sensitive || !String(arg).includes("key")).join(" ")} failed (${code}): ${stderr.trim() || "no diagnostic output"}`,
    )));
    if (input) child.stdin.end(input);
  });
}

const cli = (args, options) => run("npx", ["--yes", `supabase@${CLI_VERSION}`, ...args], options);

async function portsAvailable(ports) {
  const servers = [];
  try {
    for (const port of ports) await new Promise((resolve, reject) => {
      const server = net.createServer().once("error", reject).listen(port, "127.0.0.1", () => { servers.push(server); resolve(); });
    });
    return true;
  } catch { return false; }
  finally { await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))); }
}

export async function allocatePortBlock(seed = process.pid) {
  for (let offset = 0; offset < 100; offset++) {
    const base = 20000 + ((seed + offset * 37) % 2000) * 10;
    const ports = Array.from({ length: 9 }, (_, index) => base + index);
    if (await portsAvailable(ports)) return ports;
  }
  throw new Error("Could not reserve a non-conflicting local port block");
}

async function configure(workdir, projectId, ports) {
  await cli(["init", "--workdir", workdir, "--yes"], { cwd: workdir });
  const filename = path.join(workdir, "supabase/config.toml");
  let config = await readFile(filename, "utf8");
  config = config.replace(/^project_id = .*$/m, `project_id = "${projectId}"`);
  const replaceSectionPort = (section, port) => {
    const escaped = section.replaceAll(".", "\\.");
    config = config.replace(new RegExp(`(\\[${escaped}\\][^[]*?^port = )\\d+`, "m"), `$1${port}`);
  };
  replaceSectionPort("api", ports[0]);
  replaceSectionPort("db", ports[1]);
  config = config.replace(/^shadow_port = \d+$/m, `shadow_port = ${ports[2]}`);
  replaceSectionPort("studio", ports[3]);
  replaceSectionPort("local_smtp", ports[4]);
  replaceSectionPort("analytics", ports[5]);
  replaceSectionPort("db.pooler", ports[6]);
  config = config.replace(/^inspector_port = \d+$/m, `inspector_port = ${ports[7]}`);
  await writeFile(filename, config, { mode: 0o600 });
}

async function copyMigrations(workdir, versions) {
  const target = path.join(workdir, "supabase/migrations");
  await mkdir(target, { recursive: true });
  const files = (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files.filter((file) => versions(file.slice(0, 14)))) await cp(path.join("supabase/migrations", name), path.join(target, name));
  return files;
}

async function psql(projectId, sql) {
  return (await run("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql })).trim();
}

const fixtureSql = `
insert into public.matter_items(id,title,word_count,progress) values ('upgrade-item','Synthetic legacy item',1000,0.5);
insert into public.reading_sessions(id,item_id,started_at,ended_at,duration_seconds,source_device,words_estimated)
 values ('upgrade-session','upgrade-item','2026-01-01T00:00:00Z','2026-01-01T00:20:00Z',1200,'synthetic',500),
 ('upgrade-orphan',null,'2026-01-02T00:00:00Z','2026-01-02T00:10:00Z',600,'synthetic',225);
insert into public.matter_tags(id,name) values ('upgrade-tag','Synthetic legacy tag');
insert into public.item_tags(item_id,tag_id) values ('upgrade-item','upgrade-tag');
insert into public.annotations(id,item_id,text,note) values ('upgrade-annotation','upgrade-item','Synthetic highlight','Synthetic note');
insert into public.daily_stats(date,reading_time_seconds,words_read,sessions_count,items_read_count,highlights_count,top_source)
 values ('2026-01-01',1800,725,2,1,1,'synthetic');
insert into public.sync_runs(id,status,items_synced,sessions_synced,annotations_synced,tags_synced,sync_mode)
 values ('00000000-0000-4000-8000-000000000005','success',1,2,1,1,'recent_activity');
insert into public.sync_state(id,active_phase,sync_mode,item_cursor) values ('matter','complete','recent_activity','upgrade-owned-fixture');
`;

const snapshotSql = `select jsonb_build_object(
 'matter_items',(select jsonb_agg(to_jsonb(t) order by id) from public.matter_items t),
 'reading_sessions',(select jsonb_agg(to_jsonb(t) order by id) from public.reading_sessions t),
 'matter_tags',(select jsonb_agg(to_jsonb(t) order by id) from public.matter_tags t),
 'item_tags',(select jsonb_agg(to_jsonb(t) order by item_id,tag_id) from public.item_tags t),
 'annotations',(select jsonb_agg(to_jsonb(t) order by id) from public.annotations t),
 'daily_stats',(select jsonb_agg(to_jsonb(t) order by date) from public.daily_stats t),
 'sync_runs',(select jsonb_agg(to_jsonb(t) order by id) from public.sync_runs t),
 'sync_state',(select jsonb_agg(to_jsonb(t) order by id) from public.sync_state t),
 'reading_duration_total',(select coalesce(sum(duration_seconds),0) from public.reading_sessions),
 'counts',(select jsonb_build_array((select count(*) from matter_items),(select count(*) from reading_sessions),(select count(*) from matter_tags),(select count(*) from item_tags),(select count(*) from annotations),(select count(*) from daily_stats),(select count(*) from sync_runs),(select count(*) from sync_state)))
)::text;`;

async function verifyCatalog(projectId, expectedVersions) {
  const inventory = TABLES.map((table) => `'${table}'`).join(",");
  const output = await psql(projectId, `
do $$ begin
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${inventory}) and c.relkind='r' and c.relrowsecurity) <> ${TABLES.length} then raise exception 'RLS inventory mismatch'; end if;
 if exists (select 1 from (values ${TABLES.map((t) => `('${t}')`).join(",")}) v(name), (values ('anon'),('authenticated')) r(role) where has_table_privilege(r.role,'public.'||v.name,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'browser role retained effective table privileges'; end if;
 if exists (select 1 from (values ${TABLES.map((t) => `('${t}')`).join(",")}) v(name) where not has_table_privilege('service_role','public.'||v.name,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'service role missing table privileges'; end if;
 if has_function_privilege('anon','public.record_app_login_attempt(text,boolean,integer,integer)','EXECUTE') or has_function_privilege('authenticated','public.record_app_login_attempt(text,boolean,integer,integer)','EXECUTE') or exists (
   select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid='public.record_app_login_attempt(text,boolean,integer,integer)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'
 ) then raise exception 'browser/PUBLIC inherited function execution'; end if;
 if not has_function_privilege('service_role','public.record_app_login_attempt(text,boolean,integer,integer)','EXECUTE') then raise exception 'service role missing function execution'; end if;
end $$;
select version from supabase_migrations.schema_migrations order by version;`);
  assert.deepEqual(output.split("\n").filter(Boolean), expectedVersions, "migration history differs from repository chain");
  return { rls_tables: TABLES.length, browser_effective_privileges: 0, service_role_access: true, function_signature: "record_app_login_attempt(text,boolean,integer,integer)", public_execute: false };
}

async function onePath(kind, repoSha, evidenceDir, seed, dockerVersion) {
  const workdir = await mkdtemp(path.join(tmpdir(), `matter-stats-${kind}-`));
  const projectId = `matter_stats_stabilization_${kind}_${process.pid}_${Date.now()}`.replaceAll("-", "_");
  const ports = await allocatePortBlock(seed);
  const evidence = { path: kind, status: "failed", git_sha: repoSha, supabase_cli: CLI_VERSION, node: process.version, docker: dockerVersion, migrations: [], preservation: kind === "fresh" ? "not_applicable" : false, data_api: false, catalog: false, cleanup: "pending" };
  let initialized = false;
  let primaryError;
  let cleanupError;
  try {
    await configure(workdir, projectId, ports);
    initialized = true;
    const all = await copyMigrations(workdir, (version) => kind === "fresh" || version <= BASELINE_VERSION);
    await cli(["start", "--workdir", workdir, "--yes"], { cwd: workdir });
    let before;
    if (kind === "upgrade") {
      await psql(projectId, fixtureSql);
      before = await psql(projectId, snapshotSql);
      await copyMigrations(workdir, (version) => version > BASELINE_VERSION);
      await cli(["migration", "up", "--local", "--workdir", workdir], { cwd: workdir });
      const after = await psql(projectId, snapshotSql);
      assert.equal(after, before, "legacy fixture changed during in-place upgrade");
      evidence.preservation = true;
      assert.equal(await psql(projectId, "select item_cursor from public.sync_state where id='matter';"), "upgrade-owned-fixture");
      await psql(projectId, "delete from public.sync_state where id='matter' and item_cursor='upgrade-owned-fixture';");
    }
    const versions = all.map((name) => name.slice(0, 14));
    evidence.catalog_evidence = await verifyCatalog(projectId, versions);
    evidence.catalog = true;
    evidence.migrations = versions;
    const status = JSON.parse(await cli(["status", "--workdir", workdir, "-o", "json"], { cwd: workdir }));
    const testEnv = sanitizedEnvironment(process.env, status);
    await run(process.execPath, [path.resolve("tests/integration/supabase-security.mjs")], { cwd: process.cwd(), env: testEnv, sensitive: true });
    evidence.data_api = true;
    evidence.data_api_evidence = {
      service_role_table_crud: "passed",
      anon_and_authenticated_denials: "passed",
      browser_rpc_denials_leave_zero_rows: "passed",
      independent_concurrency_keys: 2,
      requests_per_key: 20,
      admitted_per_key: 5,
      rejected_per_key: 15,
      persisted_per_key: 5,
      expired_attempt_cleanup: "passed",
    };
    evidence.status = "passed";
  } catch (error) {
    primaryError = error;
    evidence.error = String(error?.message ?? error).replace(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED]");
  } finally {
    try {
      if (initialized) await cli(["stop", "--workdir", workdir, "--project-id", projectId, "--no-backup", "--yes"], { cwd: workdir });
      evidence.cleanup = "passed";
    } catch (error) { cleanupError = error; evidence.cleanup = `failed: ${error.message}`; if (evidence.status === "passed") evidence.status = "failed"; }
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, `${kind}.json`), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    await rm(workdir, { recursive: true, force: true });
  }
  if (primaryError && cleanupError) throw new AggregateError([primaryError, cleanupError], `${kind} verification and cleanup both failed`);
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
}

export async function main() {
  assertSafeInvocation(process.env);
  const repoSha = (await run("git", ["rev-parse", "HEAD"])).trim();
  const evidenceDir = path.resolve(process.env.STABILIZATION_TEST_EVIDENCE_DIR || "stabilization-evidence");
  let dockerVersion;
  try {
    const dockerOutput = await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
    dockerVersion = dockerOutput.trim();
  }
  catch (error) {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, "blocked.json"), `${JSON.stringify({ status: "blocked", git_sha: repoSha, supabase_cli: CLI_VERSION, node: process.version, prerequisite: "running Docker-compatible runtime", cleanup: "not_started" }, null, 2)}\n`, { mode: 0o600 });
    throw new Error(`Blocked: a running Docker-compatible runtime is required. ${error.message}`);
  }
  const version = (await cli(["--version"])).trim();
  assert.equal(version, CLI_VERSION, "pinned Supabase CLI version mismatch");
  await onePath("fresh", repoSha, evidenceDir, process.pid, dockerVersion);
  await onePath("upgrade", repoSha, evidenceDir, process.pid + 5000, dockerVersion);
  console.log(`Fresh and upgrade verification passed. Sanitized evidence: ${evidenceDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
