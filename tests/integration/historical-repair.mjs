import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import Module, { createRequire } from 'node:module';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { sanitizedEnvironment } from '../../scripts/stabilization-db-orchestrator.mjs';
import { repairReport } from '../../scripts/historical-repair.mjs';
import { GENERATION_TABLES,GENERATION_FUNCTION_SIGNATURES } from '../../scripts/reading-generation-inventory.mjs';
import { assertSuccessful } from './supabase-security-assertions.mjs';

assert.equal(process.env.DISPOSABLE_DB_ACK,'yes');
const project=process.env.STABILIZATION_TEST_SQL_PROJECT;
assert.match(project??'',/^matter-stats-(fresh|upgrade)-[a-z0-9-]+$/);
const sqlOnly=process.env.TASK20_SQL_ONLY==='yes',root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const config={command:'docker',args:['--host=unix:///var/run/docker.sock','exec','-i',`supabase_db_${project}`,'psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-f','-'],env:sanitizedEnvironment()};
function sql(statement){return new Promise((resolve,reject)=>{const c=spawn(config.command,config.args,{env:config.env,stdio:['pipe','pipe','pipe']});let out='',error='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>error+=d);c.on('error',reject);c.on('close',code=>code===0?resolve(out.trim()):reject(new Error(`Synthetic SQL failed: ${error}`)));c.stdin.end(statement);});}
const q=v=>v===null?'null':typeof v==='object'?`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`:typeof v==='string'?`'${v.replaceAll("'","''")}'`:String(v);
let service,anon,authenticated,authUser;
if(!sqlOnly){
  const url=process.env.STABILIZATION_TEST_SUPABASE_URL;assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
  service=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY,options);
  anon=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY,options);
  authenticated=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY,options);
}
async function rpc(name,args){
  if(sqlOnly)return JSON.parse(await sql(`set role service_role; select public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${k==='p_ids'?`array[${v.map(q).join(',')}]::text[]`:q(v)}`).join(',')});`));
  const r=await service.rpc(name,args);assertSuccessful(r,name);return r.data;
}
const json=async s=>JSON.parse(await sql(s));
const control=()=>json('select to_jsonb(c)::text from public.reading_generation_control c;');
const run=id=>json(`select to_jsonb(g)::text from public.reading_generations g where id='${id}';`);
const owner=crypto.randomUUID(),prefix=`repair-${owner}`,checks=[];
const baseDate='2401-01-01',stale='2401-01-03',ids=new Set();
const originalResolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){if(request==='server-only')return path.join(root,'tests/fixtures/server-only.cjs');if(request.startsWith('@/'))return path.join(root,'.test-build',`${request.slice(2)}.js`);return originalResolve.call(this,request,parent,...rest);};
const require=createRequire(import.meta.url);
const derived=require(path.join(root,'.test-build/lib/derived-generation.js'));
const queries=require(path.join(root,'.test-build/lib/supabase-queries.js'));
const articles=require(path.join(root,'.test-build/lib/articles-service.js'));
const {readCompleteSessions}=require(path.join(root,'.test-build/lib/complete-session-query.js'));
const {normalizeReadingSession}=require(path.join(root,'.test-build/lib/matter-normalizers.js'));
let admin,daily,lease,originalStream,receipt=null;
const snapshot=()=>sql(`select jsonb_build_object('sessions',(select jsonb_agg(to_jsonb(s) order by id) from public.reading_sessions s),
  'daily',(select jsonb_agg(to_jsonb(d) order by date) from public.daily_stats d),
  'items',(select jsonb_agg(to_jsonb(i) order by id) from public.matter_items i),
  'progress',(select jsonb_agg(to_jsonb(s) order by stream) from public.matter_sync_streams s),
  'dirty',(select jsonb_agg(to_jsonb(d) order by date) from public.matter_dirty_rollups d),
  'receipts',(select jsonb_agg(to_jsonb(r) order by stream) from public.matter_page_receipts r))::text;`);
const estimates=(id,keys)=>rpc('read_generation_estimates',{p_generation:id,p_ids:keys});
const args=g=>({p_id:g.id,p_owner:g.owner,p_fence:g.fence});
async function prepare(){const c=await control(),id=crypto.randomUUID();ids.add(id);const g=await rpc('repair_prepare',{p_id:id,p_owner:owner,p_expected_active:c.active,p_expected_epoch:c.epoch,p_timezone:'Europe/Athens'});ids.add(g.baseline);return g;}
async function batch(g){const result=await rpc('repair_batch',{...args(g),p_rows:500,p_milliseconds:1000});assert.ok(result.processed<=500);return result.run;}
async function capture(g){for(let i=0;i<500&&g.state.startsWith('capture');i++)g=await batch(g);assert.ok(!g.state.startsWith('capture'));return g;}
async function reconcile(g){g=await run(g.id);if(g.state==='ready')g.state='catchup';
  if(g.state==='catchup')for(let i=0;i<500;i++){const result=await rpc('repair_batch',{...args(g),p_rows:500,p_milliseconds:1000});g=result.run;if(!result.processed)break;}
  await rpc('repair_reconcile',args(g));g=await run(g.id);for(let i=0;i<500&&g.state.startsWith('verify');i++)g=await batch(g);return g;
}
async function transition(g,rollback=false,expected){const c=expected??await control();return rpc('repair_transition',{...args(g),p_expected_active:c.active,p_expected_epoch:c.epoch,p_rollback:rollback});}
async function reference(gen){
  const raw=await json(`select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]')::text from public.reading_sessions s;`);
  const rows=await json(`select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]')::text from public.reading_generation_sessions s where generation='${gen}';`);
  assert.equal(rows.length,raw.length);const expected=new Map();const dates=new Map();
  for(const r of raw){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Athens',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(r.started_at)).map(p=>[p.type,p.value]));const date=`${parts.year}-${parts.month}-${parts.day}`,words=Math.round(r.duration_seconds/60*225);expected.set(r.id,{words,date,seconds:r.duration_seconds});const d=dates.get(date)??{seconds:0,words:0,sessions:0};d.seconds+=r.duration_seconds;d.words+=words;d.sessions++;dates.set(date,d);}
  for(const r of rows){const e=expected.get(r.id);assert.equal(r.words_estimated,e.words);assert.equal(r.date,e.date);assert.equal(r.duration_seconds,e.seconds);assert.equal(r.word_estimation_method,'session-duration-225-round-v1');}
  const days=await json(`select coalesce(jsonb_agg(to_jsonb(s) order by date),'[]')::text from public.reading_generation_days s where generation='${gen}';`);
  for(const d of days){const e=dates.get(d.date)??{seconds:0,words:0,sessions:0};assert.equal(d.reading_time_seconds,e.seconds);assert.equal(d.words_read,e.words);assert.equal(d.sessions_count,e.sessions);dates.delete(d.date);}assert.equal(dates.size,0);return {sessions:raw.length,days:days.length};
}
const temp=await mkdtemp(path.join(os.tmpdir(),'task20-cli-'));
const serviceFile=`/tmp/${prefix}-services.conf`;
await writeFile(path.join(temp,'services.conf'),'[synthetic_repair]\nhost=/var/run/postgresql\ndbname=postgres\nuser=postgres\n',{mode:0o600});
const copy=spawnSync('docker',['--host=unix:///var/run/docker.sock','cp',path.join(temp,'services.conf'),`supabase_db_${project}:${serviceFile}`],{env:config.env});assert.equal(copy.status,0);
await writeFile(path.join(temp,'psql'),`#!/bin/sh\nexec docker --host=unix:///var/run/docker.sock exec -i -e PGSERVICEFILE="$PGSERVICEFILE" supabase_db_${project} psql "$@"\n`,{mode:0o700});
const cliFile=path.join(root,'scripts/historical-repair.mjs');
const cliEnv={...config.env,PATH:`${temp}:${config.env.PATH}`,HISTORICAL_REPAIR_ISOLATED_ACK:'yes',HISTORICAL_REPAIR_ISOLATED_PGSERVICE:'synthetic_repair',HISTORICAL_REPAIR_ISOLATED_PGSERVICEFILE:serviceFile};
function cli(command,a={}) {const result=spawnSync(process.execPath,[cliFile,command,'--target','isolated',...Object.entries(a).flatMap(([k,v])=>[`--${k}`,String(v)])],{env:cliEnv,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout.trim());}
async function boundary(g){
  const c=await control();let racingLease;
  if(!sqlOnly){const racingOwner=crypto.randomUUID();racingLease=(await rpc('acquire_matter_sync_lease',{p_account_scope:'matter',p_owner:racingOwner,p_ttl_seconds:120}))[0];}
  const child=spawn(config.command,config.args,{env:config.env,stdio:['pipe','pipe','pipe']});let out='',error='';let lockedResolve;
  const locked=new Promise(resolve=>{lockedResolve=resolve;});
  child.stdout.on('data',d=>{out+=d;if(out.includes('LOCKED'))lockedResolve();});child.stderr.on('data',d=>error+=d);
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(error)));});done.catch(()=>{});
  child.stdin.write("begin;set local idle_in_transaction_session_timeout='10s';select singleton from public.reading_generation_control where singleton for update;select 'LOCKED';\n");
  await Promise.race([locked,done.then(()=>{throw new Error('Boundary holder ended before lock acquired');})]);
  const writer=sqlOnly?sql(`insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated) values('${prefix}-boundary-race','2401-01-02T14:00:00Z',60,225);`)
    :rpc('sync_upsert_reading_sessions',{p_account_scope:'matter',p_owner:racingLease.owner,p_generation:racingLease.generation,p_rows:[normalizeReadingSession({id:`${prefix}-boundary-race`,date:'2401-01-02T14:00:00Z',seconds_read:60})]});writer.catch(()=>{});
  let queued=false;
  for(let i=0;i<30;i++){
    const waiting=await sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and (query like '%sync_upsert_reading_sessions%' or query like '%boundary-race%');");
    if(Number(waiting)>0){queued=true;break;}
    await new Promise(r=>setTimeout(r,50));
  }
  child.stdin.end(`select public.repair_transition('${g.id}','${g.owner}',${g.fence},'${c.active}',${c.epoch},false);commit;`);
  await Promise.all([done,writer]);assert.ok(queued,'Real racing writer must wait on cutover coordination');
  if(racingLease)assert.equal(await rpc('release_matter_sync_lease',{p_account_scope:'matter',p_owner:racingLease.owner,p_generation:racingLease.generation}),true);
  assert.equal((await control()).active,g.id);assert.equal((await estimates(g.id,[`${prefix}-boundary-race`]))[0].words_estimated,225);
}

let owned=false,report;
try {
  assert.equal(await sql('select count(*) from public.reading_generations;'),'0','Generation fixture must own an empty repair namespace');
  assert.equal(await sql(`select count(*) from public.reading_sessions where id like '${prefix}%';`),'0');
  assert.equal(await sql(`select count(*) from public.daily_stats where date between '2401-01-01' and '2401-01-04';`),'0');owned=true;
  assert.equal(await sql("select count(*) from public.reading_sessions where id='';"),'0');
  // An unresolved null duration/timestamp visibly blocks readiness, with retained reasons.
  await sql(`insert into public.reading_sessions(id,started_at,duration_seconds) values('${prefix}-invalid',null,null),('${prefix}-infinite','infinity',1);
    insert into public.reading_sessions(id,started_at,duration_seconds,source_device) values('','2401-01-01T10:00:00Z',1,'${prefix}');`);
  let bad=await capture(await prepare());assert.equal(bad.state,'blocked');assert.equal(bad.invalid_rows,3);
  assert.deepEqual(await json(`select to_jsonb(invalid_reasons) from public.reading_repair_source where generation='${bad.id}' and key='${prefix}-invalid';`),['invalid_duration','invalid_timestamp']);
  await assert.rejects(transition(bad));cli('cancel',{run:bad.id,owner:bad.owner,fence:bad.fence});
  await sql(`delete from public.reading_sessions where id in ('${prefix}-invalid','${prefix}-infinite') or (id='' and source_device='${prefix}');`);
  checks.push('Unresolved invalid historical input remains explicit; capture completes blocked, cutover rejected, owned seed removed without automatic correction');
  await sql(`insert into public.matter_items(id,title,source,word_count,progress) values('${prefix}-item','Synthetic repair item','preserve-metadata.example',999999,0.4);
    insert into public.reading_sessions(id,item_id,started_at,duration_seconds,words_estimated) values('${prefix}-linked','${prefix}-item','2401-01-02T10:00:00Z',130,0);
    insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated,source_device)
    select '${prefix}-tie-'||lpad(i::text,5,'0'),'2401-01-01T10:00:00Z',1,3,'synthetic-preserve' from generate_series(1,10003) i;
    insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated) select '${prefix}-boundary-'||i,'2401-01-02T10:00:00Z',i,0 from generate_series(0,600) i;
    insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated) select '${prefix}-sixty-'||i,'2400-12-31T22:00:00Z',60,1000 from generate_series(1,3) i;
    insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated) values
    ('${prefix}-dst-spring','2026-03-29T00:30:00Z',7200,1),('${prefix}-dst-autumn','2026-10-25T01:30:00Z',130,1),
    ('${prefix}-week','2026-09-27T21:00:00Z',246,1),('${prefix}-month','2026-09-30T21:00:00Z',262,1),
    ('${prefix}-year','2025-12-31T22:00:00Z',2,1);
    insert into public.daily_stats(date,reading_time_seconds,words_read,sessions_count,items_read_count,highlights_count,top_source)
      values('2401-01-01',10300,30000,3,42,17,'preserve.example'),('2401-01-03',60,1000,1,8,9,'stale.example');`);
  const before=await snapshot();let g=await prepare();
  await assert.rejects(sql(`insert into public.reading_sessions(id,started_at,duration_seconds) values('${prefix}-blocked','2401-01-01T12:00:00Z',1);`));
  const prior=await run(g.id);
  await sql('revoke select on public.reading_sessions from service_role;');
  try {await assert.rejects(batch(g));assert.deepEqual(await run(g.id),prior);} finally {await sql('grant select on public.reading_sessions to service_role;');}
  await assert.rejects(sql(`begin;select public.repair_batch('${g.id}','${g.owner}',${g.fence},100,1000);select 1/0;commit;`));
  assert.deepEqual(await run(g.id),prior);assert.equal(await sql(`select count(*) from public.reading_repair_source where generation='${g.id}';`),'0');
  // A fresh process commits a batch, then is killed before receiving an operator response.
  const worker=`import {repairQuery} from ${JSON.stringify(new URL('../../scripts/historical-repair.mjs',import.meta.url).href)}; await repairQuery(${JSON.stringify(config)},${JSON.stringify(`select public.repair_batch('${g.id}','${g.owner}',${g.fence},500,1000)`)}); process.kill(process.pid,'SIGKILL');`;
  const killed=spawnSync(process.execPath,['--input-type=module','-e',worker],{env:sanitizedEnvironment(),encoding:'utf8'});assert.equal(killed.signal,'SIGKILL');
  g=cli('status',{run:g.id});assert.ok(g.captured_sessions>0&&g.captured_sessions<=500);
  g=cli('resume',{run:g.id,owner:g.owner,fence:g.fence,rows:1,milliseconds:1}).run;
  const staleWorker=g;const successor=crypto.randomUUID();
  await assert.rejects(rpc('repair_claim',{p_id:g.id,p_owner:successor,p_expected_fence:g.fence}));
  await sql(`update public.reading_generations set expires_at=clock_timestamp()-interval '1 second' where id='${g.id}';`);
  g=cli('claim',{run:g.id,owner:successor,fence:g.fence});
  await assert.rejects(batch(staleWorker));await assert.rejects(transition(g));
  g=await capture(g);assert.equal(g.state,'catchup');assert.equal(await snapshot(),before);
  checks.push('10000+ tied sessions; atomic batch rollback/checkpoint; committed-response loss/SIGKILL; fresh-process resume; interrupted capture barrier; competing owner/stale fence/expiry takeover; no partial activation');
  const preview=cli('preview',{run:g.id,start:'2401-01-01',end:'2401-01-04',timezone:'Europe/Athens',out:path.join(temp,'capture.json')});
  assert.deepEqual(preview.daily,(await repairReport(config,{run:g.id,start:'2401-01-01',end:'2401-01-04',timezone:'Europe/Athens'})).daily);
  assert.equal(preview.daily.find(d=>d.date===baseDate).proposed.words_read,40687); // 10003 × 4 + 3 × 225
  assert.equal(preview.daily.find(d=>d.date===stale).staleDateWouldBecomeEmpty,true);assert.equal(preview.daily.find(d=>d.date==='2401-01-02').missingRollup,true);
  assert.ok(preview.monthly[0].delta);assert.equal(preview.monthly[0].explanation.status,'unavailable');
  const captured=await sql(`select md5(string_agg(row_data::text,E'\\n' order by kind,key)) from public.reading_repair_source where generation='${g.id}';`);
  checks.push('Task 19 immutable daily/monthly old/new/delta, missing/stale dates and unavailable legacy explanations consumed; provenance never inferred from equality');
  // Insert behind the cursor, update a processed id, move its date; immutable capture remains unchanged.
  await Promise.all([batch(g),sql(`insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated) values('${prefix}-000-new','2401-01-01T10:00:00Z',60,225);
    update public.reading_sessions set duration_seconds=6,words_estimated=23,started_at='2401-01-02T12:00:00Z' where id='${prefix}-tie-00001';`)]);
  assert.equal(await sql(`select md5(string_agg(row_data::text,E'\\n' order by kind,key)) from public.reading_repair_source where generation='${g.id}';`),captured);
  const changedSnapshot=await snapshot();g=await reconcile(g);assert.equal(g.state,'ready');assert.equal(g.mismatches,0);const ref=await reference(g.id);
  assert.equal(await sql(`select sum(words_estimated) from public.reading_generation_sessions where generation='${g.id}' and id like '${prefix}-sixty-%';`),'675');
  await assert.rejects(estimates(g.id,[`${prefix}-boundary-130`]));
  const bounds=await json(`select jsonb_agg(jsonb_build_object('id',id,'words_estimated',words_estimated)) from public.reading_generation_sessions where generation='${g.id}' and id in (${[2,6,130,246,262].map(i=>q(`${prefix}-boundary-${i}`)).join(',')});`);assert.deepEqual(new Map(bounds.map(r=>[r.id,r.words_estimated])),new Map([[2,8],[6,23],[130,487],[246,922],[262,982]].map(([i,w])=>[`${prefix}-boundary-${i}`,w])));
  if(!sqlOnly){
    // Exercise actual low-cap raw keyset and production derived readers.
    const url=process.env.STABILIZATION_TEST_SUPABASE_URL;
    const capped=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false},global:{fetch:(input,init)=>{const u=new URL(String(input));if(u.pathname.endsWith('/reading_sessions')){const limit=Number(u.searchParams.get('limit'));u.searchParams.set('limit',String(Math.min(limit||500,127)));}return fetch(u,init);}}});
    const complete=await readCompleteSessions(()=>capped.from('reading_sessions').select('id,started_at,duration_seconds'));assert.equal(complete.length,ref.sessions);
    const oldContext=derived.createDerivedGenerationContext(service);const oldId=await oldContext.generation;
    const oldEstimates=await derived.readDerivedEstimates(service,[`${prefix}-boundary-130`],oldContext);assert.equal(oldEstimates.get(`${prefix}-boundary-130`),0);
    assert.equal((await articles.getArticleDetail(service,`${prefix}-item`)).sessions[0].words_estimated,0);
    const switched=await transition(g);
    assert.equal((await articles.getArticleDetail(service,`${prefix}-item`)).sessions[0].words_estimated,487);assert.equal(switched.active,g.id);
    assert.equal((await derived.readDerivedEstimates(service,[`${prefix}-boundary-130`],oldContext)).get(`${prefix}-boundary-130`),0);
    assert.equal((await derived.readDerivedEstimates(service,[`${prefix}-boundary-130`],derived.createDerivedGenerationContext(service))).get(`${prefix}-boundary-130`),487);
    const trend=await queries.getReadingTrend(service,3,new Date('2401-01-03T12:00:00Z'));
    const empty=trend.find(d=>d.date===stale);assert.equal(empty.words_read,0);assert.equal(empty.highlights_count,9);assert.equal(empty.items_read_count,8);assert.equal(empty.top_source,'stale.example');
    assert.equal(oldId,g.parent);
  }else await transition(g);
  assert.equal(await snapshot(),changedSnapshot);
  const cut=await control();assert.deepEqual(await transition(g,false,cut),cut);
  const rollback=await transition(g,true);assert.equal(rollback.active,g.parent);assert.equal((await estimates(g.parent,[`${prefix}-boundary-130`]))[0].words_estimated,0);
  assert.deepEqual(await transition(g,true),rollback);assert.equal(await snapshot(),changedSnapshot);
  checks.push('Bounded atomic cutover and rollback before ingestion; captured request generation remains old across switch; stale reading dates zeroed while unrelated daily metadata retained; raw UTC/durations/ids/all columns unchanged');
  // Rollback switches away; this retained canonical generation cannot be reactivated by an old operator.
  await assert.rejects(transition(g));
  // New repair for the ingestion-after-cutover and stale-readiness cases.
  let next=await capture(await prepare());next=await reconcile(next);
  const readiness=await control();
  await sql(`update public.reading_sessions set started_at='2401-01-02T13:00:00Z' where id='${prefix}-000-new';`);
  await assert.rejects(transition(next,false,readiness));next=await reconcile(next);assert.equal(next.state,'ready');
  const preBoundary=JSON.parse(await snapshot());await boundary(next);
  const postBoundary=JSON.parse(await snapshot());assert.deepEqual(postBoundary.sessions.filter(s=>s.id!==`${prefix}-boundary-race`),preBoundary.sessions);assert.deepEqual(postBoundary.daily,preBoundary.daily);await reference(next.id);
  if(!sqlOnly){
    process.env.SUPABASE_URL=process.env.STABILIZATION_TEST_SUPABASE_URL;process.env.SUPABASE_SERVICE_ROLE_KEY=process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY;process.env.APP_TIMEZONE='Europe/Athens';
    admin=require(path.join(root,'.test-build/lib/supabase-admin.js'));daily=require(path.join(root,'.test-build/lib/daily-stats.js'));
    const leaseOwner=crypto.randomUUID(),l=(await rpc('acquire_matter_sync_lease',{p_account_scope:'matter',p_owner:leaseOwner,p_ttl_seconds:120}))[0];lease={accountScope:'matter',owner:leaseOwner,generation:l.generation};
    originalStream=await json("select to_jsonb(s) from public.matter_sync_streams s where stream='recent_sessions';");
    await admin.upsertMatterSyncStream({...originalStream,cursor:null,cycle_active:true,cycle_started_at:'2401-03-01T00:00:00Z',cycle_generation:originalStream.cycle_generation+1,page_limit:100,filters:{},retry_at:null,coverage_window:'all'},lease);
    const stream=await json("select to_jsonb(s)-'created_at'-'updated_at' from public.matter_sync_streams s where stream='recent_sessions';");
    receipt=crypto.randomUUID();
    const rows=[1,2,3].map(i=>normalizeReadingSession({id:`${prefix}-after-${i}`,date:'2401-01-04T10:00:00Z',seconds_read:1}));
    await admin.commitMatterPage({receiptId:receipt,previousReceiptId:null,expected:stream,plan:{placeholders:[],items:[],sessions:rows,tags:[],annotations:[],itemTags:[],itemTagIds:[]},hasMore:true,nextCursor:'synthetic-next',timezone:'Europe/Athens'},lease);
    const pending=await admin.getPendingDailyStats(32,lease);assert.ok(pending.some(d=>d.date==='2401-01-04'));
    assert.ok(await daily.processPendingDailyStats(lease)>0);assert.equal((await admin.getPendingDailyStats(32,lease)).length,0);
    assert.equal((await queries.getReadingTrend(service,1,new Date('2401-01-04T12:00:00Z'))).find(d=>d.date==='2401-01-04').words_read,12);
  }else await sql(`insert into public.reading_sessions(id,started_at,duration_seconds,words_estimated) select '${prefix}-after-'||i,'2401-01-04T10:00:00Z',1,4 from generate_series(1,3) i;`);
  const refAfter=await reference(next.id),afterIngest=await snapshot();const rollbackContract=await control();cli('rollback',{run:next.id,owner:next.owner,fence:next.fence,active:rollbackContract.active,epoch:rollbackContract.epoch});assert.equal(await snapshot(),afterIngest);
  const target=await control();assert.equal((await estimates(target.active,[`${prefix}-after-1`]))[0].words_estimated,4);
  assert.equal(await sql(`select sessions_count from public.reading_generation_days where generation='${target.active}' and date='2401-01-04';`),'3');
  assert.deepEqual(await transition(next,true),target);await assert.rejects(transition(next,false,readiness));
  checks.push('Transactional cutover mutex demonstrably queues a racing insert which maintains the newly active generation; behind-cursor insert/update/date reassignment caught; readiness invalidated by racing input; normal fenced page ingestion and exact dirty-rollup recovery maintain active/rollback generations; rollback includes every newly imported raw session and repeats idempotently');
  // Canonical cutover then unchanged run must produce no switch.
  let canonical=await reconcile(await capture(await prepare()));await transition(canonical);const unchangedControl=await control();const stableBefore=await snapshot();
  let same=await reconcile(await capture(await prepare()));assert.equal(same.active_differences,0);const noOp=await control();cli('cutover',{run:same.id,owner:same.owner,fence:same.fence,active:noOp.active,epoch:noOp.epoch});
  assert.equal((await run(same.id)).state,'noop');assert.equal((await control()).active,unchangedControl.active);assert.equal((await control()).epoch,unchangedControl.epoch);assert.equal(await snapshot(),stableBefore);
  checks.push('Repeated completed run over unchanged inputs independently reconciles identically and performs no unnecessary cutover; all source/unrelated/progress values preserved');
  if(!sqlOnly){
    const created=await service.auth.admin.createUser({email:`${prefix}@example.test`,password:`A9!${crypto.randomUUID()}`,email_confirm:true});assertSuccessful(created,'create synthetic auth user');authUser=created.data.user.id;
    // Obtain a browser role token without reusing any application session or production identity.
    const password=`A9!${crypto.randomUUID()}`;assertSuccessful(await service.auth.admin.updateUserById(authUser,{password}),'set synthetic password');assertSuccessful(await authenticated.auth.signInWithPassword({email:`${prefix}@example.test`,password}),'browser sign in');
    for(const client of [anon,authenticated]){
      for(const table of GENERATION_TABLES){
        assert.equal((await client.from(table).select('*')).error?.code,'42501');
        const key=table==='reading_generation_control'?'singleton':table==='reading_generations'?'id':'generation';
        const value=key==='singleton'?true:same.id;
        assert.equal((await client.from(table).insert({[key]:value})).error?.code,'42501');
        assert.equal((await client.from(table).update({[key]:value}).eq(key,value)).error?.code,'42501');
        assert.equal((await client.from(table).delete().eq(key,value)).error?.code,'42501');
      }
      for(const name of ['repair_prepare','repair_claim','repair_batch','repair_reconcile','repair_transition','repair_cancel','read_generation_days','read_generation_estimates']){
        const payloads={repair_prepare:{p_id:crypto.randomUUID(),p_owner:owner,p_expected_active:null,p_expected_epoch:0,p_timezone:'Europe/Athens'},repair_claim:{p_id:same.id,p_owner:owner,p_expected_fence:1},repair_batch:{...args(same),p_rows:1,p_milliseconds:1},repair_reconcile:args(same),repair_transition:{...args(same),p_expected_active:null,p_expected_epoch:0,p_rollback:false},repair_cancel:args(same),read_generation_days:{p_generation:null,p_after:null,p_since:null,p_limit:1},read_generation_estimates:{p_generation:null,p_ids:[]}};
        assert.equal((await client.rpc(name,payloads[name])).error?.code,'42501');
      }
    }
    checks.push('Real anonymous and authenticated Data API denials for every generation table and operator/read RPC; invoker exact ACL/search_path inventory; server production read/page/ack paths exercised');
  }
  checks.push('Actual isolated operator CLI status/resume/claim/preview/cancel/cutover/rollback exercised in fresh processes with dedicated synthetic libpq configuration');
  report={status:'passed',checks,reference:ref,afterIngestion:refAfter,realSqlAndDataApi:!sqlOnly,syntheticOnly:true,sqlOnly,
    functionSignatures:GENERATION_FUNCTION_SIGNATURES.length};
} finally {
  const removed=spawnSync('docker',['--host=unix:///var/run/docker.sock','exec',`supabase_db_${project}`,'rm','-f',serviceFile],{env:config.env});assert.equal(removed.status,0);await rm(temp,{recursive:true,force:true});
  Module._resolveFilename=originalResolve;
  if(authUser)assertSuccessful(await service.auth.admin.deleteUser(authUser),'cleanup synthetic auth user');
  if(owned){
    const all=await json('select coalesce(jsonb_agg(id),\'[]\') from public.reading_generations;');assert.ok(all.every(id=>ids.has(id)),'Refuse unrelated generation cleanup');
    await sql('update public.reading_generation_control set active=null,previous=null,building=null,frozen=null where singleton;');
    if(lease){if(receipt)assert.equal(await sql(`delete from public.matter_page_receipts where receipt_id='${receipt}' returning receipt_id;`),receipt);await admin.upsertMatterSyncStream(originalStream,lease);assert.equal(await rpc('release_matter_sync_lease',{p_account_scope:'matter',p_owner:lease.owner,p_generation:lease.generation}),true);}
    await sql(`delete from public.reading_sessions where id='' and source_device='${prefix}';delete from public.matter_dirty_rollups where date between '2401-01-01' and '2401-01-04';delete from public.reading_sessions where id like '${prefix}%';delete from public.daily_stats where date between '2401-01-01' and '2401-01-04';delete from public.matter_items where id='${prefix}-item';
      delete from public.reading_repair_changes;delete from public.reading_repair_check_days;delete from public.reading_repair_source;delete from public.reading_generation_sessions;delete from public.reading_generation_days;delete from public.reading_generations;`);
  }
}
console.log(JSON.stringify({...report,cleanup:'passed'}));
