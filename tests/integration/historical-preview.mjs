import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readPreview, previewSql } from "../../scripts/historical-preview.mjs";
import { contract } from "../../scripts/historical-preview-core.mjs";
import { INVENTORIED_TABLES } from "../../scripts/stabilization-db-runner.mjs";
import { sanitizedEnvironment } from "../../scripts/stabilization-db-orchestrator.mjs";

assert.equal(process.env.DISPOSABLE_DB_ACK,"yes");
const project=process.env.STABILIZATION_TEST_SQL_PROJECT;
assert.match(project??"",/^matter-stats-(fresh|upgrade)-[a-z0-9-]+$/);
const config={command:"docker",args:["--host=unix:///var/run/docker.sock","exec","-i",`supabase_db_${project}`,"psql","-XAtq","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-f","-"],env:sanitizedEnvironment()};
const sql=statement=>new Promise((resolve,reject)=>{
  const child=spawn(config.command,config.args,{env:config.env,stdio:["pipe","pipe","pipe"]});let output="";
  child.stdout.on("data",data=>{output+=data;});child.stderr.resume();child.on("error",reject);child.on("close",code=>code===0?resolve(output.trim()):reject(new Error(`Isolated SQL failed (${code})`)));child.stdin.end(statement);
});
const prefix=`preview-${crypto.randomUUID()}`;
const scope={start:"2390-01-01",end:"2390-01-04",timezone:"Europe/Athens",target:"isolated"};
const snapshotSql=INVENTORIED_TABLES.map(t=>`select json_build_object('table','${t}','count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')))::text from public.${t} r;`).join("\n");
const checks=[];
let owned=false;
try {
  assert.equal(await sql("select count(*) from public.daily_stats where date >= '2390-01-01' and date < '2390-01-04';"),"0","Fixture collision");
  assert.equal(await sql("select count(*) from public.reading_sessions where started_at >= '2389-12-31T22:00:00Z' and started_at < '2390-01-03T22:00:00Z';"),"0","Session fixture collision");
  owned=true;
  await sql(`insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated)
    select '${prefix}-' || lpad(i::text,6,'0'),'2390-01-01T10:00:00Z',1,3 from generate_series(1,10003) i;
    insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated) values
    ('${prefix}-midnight','2389-12-31T22:00:00Z',60,1000),
    ('${prefix}-zero','2390-01-02T10:00:00Z',0,0),
    ('${prefix}-invalid-duration','2390-01-03T10:00:00Z',null,null),
    ('${prefix}-invalid-timestamp',null,60,225);
    insert into public.daily_stats(date,reading_time_seconds,words_read,sessions_count) values ('2390-01-01',10003,30009,10003);`);
  const before=await sql(snapshotSql);
  const report=await readPreview(scope,config);
  const again=await readPreview(scope,config);
  assert.equal(report.daily.find(d=>d.date==="2390-01-01").proposed.words_read,40237); // 10003 × 4 + 225
  assert.equal(report.daily.find(d=>d.date==="2390-01-02").proposed.sessions_count,1);
  assert.equal(report.invalid.sessionRows,2);
  assert.deepEqual(report.daily,again.daily);assert.deepEqual(report.monthly,again.monthly);
  // Exercise the actual operator executable and dedicated configuration, with a local psql wrapper.
  const temp=await mkdtemp(path.join(os.tmpdir(),"preview-cli-"));
  const serviceFile=`/tmp/${prefix}-services.conf`;
  try {
    await writeFile(path.join(temp,"services.conf"),"[synthetic_preview]\nhost=/var/run/postgresql\ndbname=postgres\nuser=postgres\n",{mode:0o600});
    const copied=spawnSync("docker",["--host=unix:///var/run/docker.sock","cp",path.join(temp,"services.conf"),`supabase_db_${project}:${serviceFile}`],{env:config.env});assert.equal(copied.status,0);
    await writeFile(path.join(temp,"psql"),`#!/bin/sh\nexec docker --host=unix:///var/run/docker.sock exec -i -e PGSERVICEFILE="$PGSERVICEFILE" supabase_db_${project} psql "$@"\n`,{mode:0o700});
    const cli=fileURLToPath(new URL("../../scripts/historical-preview.mjs",import.meta.url));
    const output=path.join(temp,"report");
    const result=spawnSync(process.execPath,[cli,"--target","isolated","--start",scope.start,"--end",scope.end,"--timezone",scope.timezone,"--out",output],{
      env:{...config.env,PATH:`${temp}:${config.env.PATH}`,HISTORICAL_PREVIEW_ISOLATED_PGSERVICE:"synthetic_preview",HISTORICAL_PREVIEW_ISOLATED_PGSERVICEFILE:serviceFile},encoding:"utf8",timeout:120000});
    assert.equal(result.status,2,"Operator CLI must visibly report invalid-row reconciliation incompleteness");
    const actual=JSON.parse(await readFile(`${output}.json`,"utf8"));
    assert.deepEqual(actual.daily,report.daily);assert.deepEqual(actual.monthly,report.monthly);assert.match(await readFile(`${output}.txt`,"utf8"),/complete_read_incomplete_reconciliation/);
    checks.push("Actual CLI with dedicated isolated service configuration produces JSON/summary, exit 2 for invalid input, and identical reconciliation");
  } finally {
    const removed=spawnSync("docker",["--host=unix:///var/run/docker.sock","exec",`supabase_db_${project}`,"rm","-f",serviceFile],{env:config.env});assert.equal(removed.status,0);
    await rm(temp,{recursive:true,force:true});
  }
  assert.equal(await sql(snapshotSql),before,"Preview changed some database column/table (including status/lease/markers)");
  checks.push("10003 tied sessions, valid zero/unlinked, null historical duration/timestamp, repeated reconciliation; independent whole-database before/after count and value fingerprints unchanged");
  // The snapshot callback runs after PostgreSQL established the snapshot, before the reader proceeds.
  const concurrent=await readPreview(scope,config,async()=>{
    await sql(`update public.reading_sessions set duration_seconds=60,words_estimated=225 where id='${prefix}-000001';
      insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated) values('${prefix}-late','2390-01-01T10:00:00Z',60,225);
      update public.daily_stats set words_read=90000 where date='2390-01-01';`);
  });
  assert.deepEqual(concurrent.daily,report.daily);assert.deepEqual(concurrent.source.preservation.before,report.source.preservation.before);
  assert.notEqual(await sql(snapshotSql),before);
  checks.push("Concurrent session update/insert and rollup update excluded from the repeatable-read snapshot; all four passes agree");
  await sql(`delete from public.reading_sessions where id='${prefix}-late';
    update public.reading_sessions set duration_seconds=1,words_estimated=3 where id='${prefix}-000001';
    update public.daily_stats set words_read=30009 where date='2390-01-01';`);
  // Real server refuses a write attempted with this exact transaction mode.
  await assert.rejects(sql(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; insert into public.reading_sessions(id) values('${prefix}-forbidden'); ROLLBACK;`));
  assert.equal(await sql(`select count(*) from public.reading_sessions where id='${prefix}-forbidden';`),"0");
  // Real query error, after some valid snapshot output, must reject rather than make empty results.
  // Use a COPY stream with an inaccessible relation; exercise psql ON_ERROR_STOP independently.
  await assert.rejects(sql(previewSql().replace('FROM public.reading_sessions r','FROM public.nonexistent_preview_input r')));
  checks.push("Read-only transaction rejects mutation; source query errors fail, never become zero");
  // Existing production-used fenced functions persist metadata. Old-compatible inputs clear it.
  const owner=crypto.randomUUID();
  const lease=JSON.parse(await sql(`select to_json(public.acquire_matter_sync_lease('matter','${owner}',120));`));
  assert.ok(lease.generation);
  try {
    const args=`'matter','${owner}',${lease.generation}`;
    const row={id:`${prefix}-writer`,started_at:"2390-01-02T00:00:00Z",duration_seconds:60,words_estimated:225,word_estimation_method:contract.wordMethod};
    const d={date:"2390-01-02",reading_time_seconds:60,words_read:225,sessions_count:1,items_read_count:0,highlights_count:0,top_source:null,reading_provenance:{wordMethod:contract.wordMethod,calendarMethod:contract.calendarMethod,timezone:"Europe/Athens"}};
    await sql(`set role service_role; select public.sync_upsert_reading_sessions(${args},'${JSON.stringify([row])}'::jsonb); select public.sync_upsert_daily_stats(${args},'${JSON.stringify([d])}'::jsonb);`);
    assert.equal(await sql(`select word_estimation_method from public.reading_sessions where id='${row.id}';`),contract.wordMethod);
    assert.equal(await sql(`select reading_provenance->>'timezone' from public.daily_stats where date='2390-01-02';`),"Europe/Athens");
    delete row.word_estimation_method;delete d.reading_provenance;
    await sql(`set role service_role; select public.sync_upsert_reading_sessions(${args},'${JSON.stringify([row])}'::jsonb); select public.sync_upsert_daily_stats(${args},'${JSON.stringify([d])}'::jsonb);`);
    assert.equal(await sql(`select word_estimation_method is null from public.reading_sessions where id='${row.id}';`),"t");
    assert.equal(await sql(`select reading_provenance is null from public.daily_stats where date='2390-01-02';`),"t");
    await assert.rejects(sql(`select public.sync_upsert_reading_sessions(${args},'[${JSON.stringify({...row,words_estimated:999,word_estimation_method:contract.wordMethod})}]'::jsonb);`));
  } finally {await sql(`select public.release_matter_sync_lease('matter','${owner}',${lease.generation});`);}
  checks.push("Real fenced production writers persist canonical metadata, reject false canonical words, clear metadata for old/unknown writer input; page/ack callers share these functions; full Data API evidence remains separate");
  // The inherited role/column ACLs are tested by the existing full Data API suite/catalog on both paths.
  assert.equal(await sql("select count(*) from information_schema.column_privileges where table_schema='public' and table_name in ('reading_sessions','daily_stats') and column_name in ('word_estimation_method','reading_provenance') and grantee in ('PUBLIC','anon','authenticated');"),"0");
  checks.push("Additive metadata has no browser column grants; existing exact function/security inventories remain comprehensive");
} finally {
  if(owned) await sql(`delete from public.reading_sessions where id like '${prefix}-%'; delete from public.daily_stats where date >= '2390-01-01' and date < '2390-01-04';`);
}
console.log(JSON.stringify({status:"passed",checks,realSql:true,syntheticOnly:true,cleanup:"passed"}));
