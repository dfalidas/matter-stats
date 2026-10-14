#!/usr/bin/env node
// Supplemental real SQL evidence. This NEVER substitutes for the full Supabase/Data API gate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizedEnvironment, legacySeedSql, preservationSql, assertLegacyPreserved } from "./stabilization-db-orchestrator.mjs";
import { catalogSql, repositoryMigrationVersions } from "./stabilization-db-runner.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const image="postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";
const env=sanitizedEnvironment(process.env.DOCKER_CONFIG?{DOCKER_CONFIG:process.env.DOCKER_CONFIG}:{});
const command=(binary,args,input,childEnv=env)=>{
  const r=spawnSync(binary,args,{cwd:root,env:childEnv,input,encoding:"utf8",timeout:120000,maxBuffer:4*1024*1024});
  if(r.error||r.status!==0)throw new Error(`${binary} failed (${r.status ?? "transport"}); supplemental isolated SQL gate incomplete`);
  return r.stdout.trim();
};
const docker=(args,input)=>command("docker",["--host=unix:///var/run/docker.sock",...args],input);
const checks=[];
async function main() {
  assert.equal(process.env.DISPOSABLE_DB_ACK,"yes","Explicit disposable acknowledgement required");
  docker(["info","--format","{{.ServerVersion}}"]);
  const sha=command("git",["rev-parse","HEAD"]),dirty=command("git",["status","--porcelain"])!=="";
  const dir=path.join(root,"artifacts/stabilization-db",sha,"task19-postgres");await mkdir(dir,{recursive:true});
  const files=(await readdir(path.join(root,"supabase/migrations"))).filter(f=>f.endsWith(".sql")).sort();
  const versions=await repositoryMigrationVersions(path.join(root,"supabase/migrations"));
  for(const mode of ["fresh","upgrade"]) {
    const owner=crypto.randomUUID(),project=`matter-stats-${mode}-task19-${owner}`,name=`supabase_db_${project}`;
    const sql=s=>docker(["exec","-i",name,"psql","-XAtq","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-f","-"],s);
    let cleanup="pending";
    try {
      docker(["run","-d","--name",name,"--label",`task19.owner=${owner}`,"-e","POSTGRES_HOST_AUTH_METHOD=trust",image]);
      let ready=false;
      for(let i=0;i<60;i++) { try {docker(["exec",name,"pg_isready","-U","postgres"]);ready=true;break;}catch {await new Promise(r=>setTimeout(r,500));} }
      assert.ok(ready,"Postgres readiness failed");
      sql("create role anon; create role authenticated; create role service_role bypassrls; create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key);");
      let before=null;
      for(const file of files) {
        if(mode==="upgrade"&&file.endsWith("_estimation_provenance.sql")) {
          sql(legacySeedSql(`task19-${owner}`));
          sql("insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated) values ('task19-legacy-equal','2030-01-01T00:00:00Z',60,225);");
          before=JSON.parse(sql(preservationSql));
        }
        sql(await readFile(path.join(root,"supabase/migrations",file),"utf8"));
        sql(`insert into supabase_migrations.schema_migrations(version) values('${file.slice(0,14)}');`);
      }
      if(mode==="upgrade") {
        assertLegacyPreserved(before,JSON.parse(sql(preservationSql)));
        assert.equal(sql("select word_estimation_method is null from public.reading_sessions where id='task19-legacy-equal';"),"t");
        assert.equal(sql("select word_estimation_method is null from public.reading_sessions where id='legacy-session';"),"t");
        assert.equal(sql("select reading_provenance is null from public.daily_stats where date='2026-05-19';"),"t");
      }
      assert.deepEqual(sql(catalogSql()).split(/\r?\n/),versions);
      const output=command(process.execPath,["tests/integration/historical-preview.mjs"],undefined,{...env,DISPOSABLE_DB_ACK:"yes",STABILIZATION_TEST_SQL_PROJECT:project});
      const integration=JSON.parse(output.split(/\r?\n/).at(-1));assert.equal(integration.status,"passed");
      checks.push({path:mode,catalog:"passed",legacyPreservation:mode==="upgrade"?"passed":"not applicable",preview:integration});
    } finally {
      assert.equal(docker(["inspect","--format",'{{index .Config.Labels "task19.owner"}}',name]),owner,"Refuse unrelated-container cleanup");
      docker(["rm","-fv",name]);cleanup="passed";
      checks.push({path:mode,cleanup});
    }
  }
  const report={status:"passed",gitSha:sha,dirtyWorktree:dirty,image,realSql:true,dataApi:"NOT RUN: supplemental SQL only",checks};
  await writeFile(path.join(dir,"results.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
}
main().catch(()=>{console.error("Task 19 supplemental PostgreSQL validation FAILED or BLOCKED; no complete fresh/upgrade claim.");process.exitCode=1;});
