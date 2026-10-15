#!/usr/bin/env node
// Supplemental SQL development check; full Supabase/Data API gate is still required.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir,readFile } from 'node:fs/promises';
import { sanitizedEnvironment } from './stabilization-db-orchestrator.mjs';
assert.equal(process.env.DISPOSABLE_DB_ACK,'yes');
const owner=crypto.randomUUID(),project=`matter-stats-fresh-task20-${owner}`,name=`supabase_db_${project}`;
const env=sanitizedEnvironment();
function docker(args,input){const r=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{env,input,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});if(r.status!==0)throw new Error(r.stderr);return r.stdout.trim();}
try {
  docker(['run','-d','--name',name,'--label',`task20.owner=${owner}`,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24']);
  for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres']);break;}catch{await new Promise(r=>setTimeout(r,500));}}
  const sql=s=>docker(['exec','-i',name,'psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres','-f','-'],s);
  sql('create role anon; create role authenticated; create role service_role bypassrls;');
  for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())sql(await readFile(`supabase/migrations/${f}`,'utf8'));
  const r=spawnSync(process.execPath,['tests/integration/historical-repair.mjs'],{env:{...env,DISPOSABLE_DB_ACK:'yes',STABILIZATION_TEST_SQL_PROJECT:project,TASK20_SQL_ONLY:'yes'},encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});
  process.stdout.write(r.stdout);process.stderr.write(r.stderr);assert.equal(r.status,0);
} finally {assert.equal(docker(['inspect','--format','{{index .Config.Labels "task20.owner"}}',name]),owner);docker(['rm','-fv',name]);}
