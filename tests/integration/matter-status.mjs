import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { sanitizedEnvironment } from '../../scripts/stabilization-db-orchestrator.mjs';
import { STATUS_TABLES, STATUS_FUNCTION_SIGNATURES } from '../../scripts/matter-status-inventory.mjs';
import { assertGrantDenied, assertSuccessful } from './supabase-security-assertions.mjs';

assert.equal(process.env.DISPOSABLE_DB_ACK,'yes');
const project=process.env.STABILIZATION_TEST_SQL_PROJECT;
assert.match(project??'',/^matter-stats-(fresh|upgrade)-[a-z0-9-]+$/);
const url=process.env.STABILIZATION_TEST_SUPABASE_URL;
assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const service=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY,options);
const anon=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY,options);
const authenticated=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY,options);
const sql=statement=>new Promise((resolve,reject)=>{
  const c=spawn('docker',['--host=unix:///var/run/docker.sock','exec','-i',`supabase_db_${project}`,'psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-f','-'],{env:sanitizedEnvironment(),stdio:['pipe','pipe','pipe']});
  let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);c.on('error',reject);c.on('close',code=>code===0?resolve(out.trim()):reject(new Error(`Disposable status SQL failed: ${err}`)));c.stdin.end(statement);
});
const q=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const rpc=async(name,args={})=>{const r=await service.rpc(name,args);assertSuccessful(r,name);return r.data;};
const read=async(table)=>{const r=await service.from(table).select('*');assertSuccessful(r,table);return r.data;};
const checks=[];
let originals,completions,attempts,lease,user;
const args=()=>({p_account_scope:'matter',p_owner:lease.owner,p_generation:lease.generation});
const acquire=async()=>{const owner=crypto.randomUUID();const rows=await rpc('acquire_matter_sync_lease',{p_account_scope:'matter',p_owner:owner,p_ttl_seconds:120});assert.equal(rows.length,1);lease={owner,generation:rows[0].generation};};
const state=async(stream)=>(await read('matter_sync_streams')).find(s=>s.stream===stream);
const begin=async(stream)=>{const s=await state(stream);return rpc('sync_upsert_stream',{...args(),p_state:{...s,cycle_active:true,cycle_started_at:'2026-10-01T00:00:00Z',cycle_generation:s.cycle_generation+1,cursor:null,retry_at:null}});};
const plan={placeholders:[],items:[],sessions:[],tags:[],itemTagIds:[],itemTags:[],annotations:[]};
const pageArgs=async(stream,more)=>({...args(),p_receipt_id:crypto.randomUUID(),p_previous_receipt_id:(await read('matter_page_receipts')).find(r=>r.stream===stream)?.receipt_id??null,p_expected:Object.fromEntries(Object.entries(await state(stream)).filter(([k])=>!['created_at','updated_at'].includes(k))),p_plan:plan,p_has_more:more,p_next_cursor:more?'synthetic-status-next':null,p_timezone:'Europe/Athens'});
try{
  originals=await read('matter_sync_streams');completions=await read('matter_cycle_completions');attempts=await read('matter_invocation_status');
  assertSuccessful(await service.from('matter_cycle_completions').delete().in('stream',['recent_sessions','library_items']),'clear disposable completion fixtures');
  await acquire();
  await begin('recent_sessions');await rpc('commit_matter_page',await pageArgs('recent_sessions',true));
  assert.deepEqual(await read('matter_cycle_completions'),[]);
  checks.push('Partial page commits do not establish completion evidence.');
  const terminal=await pageArgs('recent_sessions',false);
  await sql("create function public.disposable_status_fail() returns trigger language plpgsql security invoker set search_path='' as $$begin raise exception 'synthetic status rollback'; end;$$;create trigger disposable_status_fail before insert or update on public.matter_cycle_completions for each row execute function public.disposable_status_fail();");
  const rejected=await service.rpc('commit_matter_page',terminal);assert.ok(rejected.error);assert.equal((await state('recent_sessions')).cycle_active,true);assert.deepEqual(await read('matter_cycle_completions'),[]);
  await sql('drop trigger disposable_status_fail on public.matter_cycle_completions;drop function public.disposable_status_fail();');
  await rpc('commit_matter_page',terminal);
  const first=(await read('matter_cycle_completions'))[0];assert.equal(first.stream,'recent_sessions');assert.equal(first.source_boundary,'2026-10-01T00:00:00+00:00');assert.ok(Date.parse(first.completed_at)>Date.parse(first.source_boundary));
  await rpc('commit_matter_page',terminal);assert.deepEqual((await read('matter_cycle_completions'))[0],first);
  checks.push('Empty terminal page records actual database completion atomically; forced evidence failure rolls back checkpoint/receipt; receipt replay preserves timestamp.');
  await begin('recent_sessions');await rpc('commit_matter_page',await pageArgs('recent_sessions',true));assert.deepEqual((await read('matter_cycle_completions'))[0],first);
  await sql(`update public.matter_sync_leases set expires_at=clock_timestamp()-interval '1 second' where account_scope='matter' and owner='${lease.owner}';`);
  const stale=await service.rpc('commit_matter_page',await pageArgs('recent_sessions',false));assert.equal(stale.error?.code,'55000');assert.deepEqual((await read('matter_cycle_completions'))[0],first);
  await acquire();await begin('library_items');await rpc('commit_matter_page',await pageArgs('library_items',false));assert.equal((await read('matter_cycle_completions')).length,2);assert.deepEqual((await read('matter_cycle_completions')).find(r=>r.stream==='recent_sessions'),first);
  checks.push('Later partial work and expired workers preserve prior completion; metadata completion is independent.');
  const a=await pageArgs('recent_sessions',false),b={...a,p_receipt_id:crypto.randomUUID()};
  const racing=await Promise.all([service.rpc('commit_matter_page',a),service.rpc('commit_matter_page',b)]);assert.equal(racing.filter(r=>!r.error).length,1);assert.equal(racing.find(r=>r.error).error.code,'PT409');
  checks.push('Concurrent terminal transitions produce one completion; stale transition cannot refresh it.');
  const old=crypto.randomUUID(),latest=crypto.randomUUID();
  await rpc('record_matter_invocation',{p_id:old,p_trigger:'manual',p_outcome:'attempted'});await rpc('record_matter_invocation',{p_id:latest,p_trigger:'manual',p_outcome:'attempted'});
  await rpc('record_matter_invocation',{p_id:old,p_trigger:'manual',p_outcome:'complete'});assert.equal((await read('matter_invocation_status')).find(r=>r.trigger==='manual').outcome,'attempted');
  await rpc('record_matter_invocation',{p_id:latest,p_trigger:'manual',p_outcome:'skipped_locked'});assert.equal((await read('matter_invocation_status')).find(r=>r.trigger==='manual').outcome,'skipped_locked');
  const generation=await rpc('read_matter_generation_status');assert.ok(Object.hasOwn(generation,'activeId'));assert.ok(Object.hasOwn(generation,'rolledBack'));assert.ok(!JSON.stringify(generation).includes('owner'));
  const retry=await rpc('read_matter_retry_status',{p_now:new Date().toISOString()});assert.ok(Number.isSafeInteger(retry.pendingRequests));assert.ok(!JSON.stringify(retry).includes('cursor'));
  checks.push('Invocation evidence records skipped attempts with explicit trigger and rejects late outcome overwrite; bounded generation/retry reads project safe fields.');
  const password=`synthetic-${crypto.randomUUID()}`;
  const created=await service.auth.admin.createUser({email:`status-${crypto.randomUUID()}@example.test`,password,email_confirm:true});assertSuccessful(created,'create status security user');user=created.data.user.id;
  assertSuccessful(await authenticated.auth.signInWithPassword({email:created.data.user.email,password}),'authenticate status security user');
  for(const [role,client] of [["anon",anon],["authenticated",authenticated]]){
    for(const table of STATUS_TABLES){
      const fixture=table==='matter_cycle_completions'?{stream:'recent_sessions',cycle_generation:1,source_boundary:'2026-10-01T00:00:00Z',completed_at:'2026-10-01T01:00:00Z'}:{trigger:'manual',id:crypto.randomUUID(),attempted_at:'2026-10-01T00:00:00Z',outcome:'attempted'};
      const key=table==='matter_cycle_completions'?'stream':'trigger',value=fixture[key];
      for(const [index,response] of [await client.from(table).select('*'),await client.from(table).insert(fixture),await client.from(table).update(fixture).eq(key,value),await client.from(table).delete().eq(key,value)].entries())assertGrantDenied(response,{role,operation:['SELECT','INSERT','UPDATE','DELETE'][index],kind:'table',name:table});
    }
    const payloads={'record_matter_cycle_completion':{},record_matter_invocation:{p_id:crypto.randomUUID(),p_trigger:'manual',p_outcome:'attempted'},read_matter_generation_status:{},read_matter_retry_status:{p_now:new Date().toISOString()}};
    for(const signature of STATUS_FUNCTION_SIGNATURES){const name=signature.split('(')[0];assertGrantDenied(await client.rpc(name,payloads[name]),{role,operation:'EXECUTE',kind:'function',name});}
  }
  checks.push('Every new table CRUD and exact function signature denied through real Data API to anonymous and authenticated roles; service-role controls succeed.');
}finally{
  await sql('drop trigger if exists disposable_status_fail on public.matter_cycle_completions;drop function if exists public.disposable_status_fail();');
  if(lease)await rpc('release_matter_sync_lease',args());
  if(originals)for(const s of originals)await sql(`update public.matter_sync_streams set cycle_active=${s.cycle_active},cycle_started_at=${s.cycle_started_at?`'${s.cycle_started_at}'`:'null'},cycle_generation=${s.cycle_generation},cursor=${s.cursor?`'${s.cursor.replaceAll("'","''")}'`:'null'},completed_watermark=${s.completed_watermark?`'${s.completed_watermark}'`:'null'},retry_at=${s.retry_at?`'${s.retry_at}'`:'null'} where stream='${s.stream}';`);
  if(completions){await sql('delete from public.matter_cycle_completions;');for(const r of completions)await sql(`insert into public.matter_cycle_completions select * from jsonb_populate_record(null::public.matter_cycle_completions,${q(r)});`);}
  if(attempts){await sql('delete from public.matter_invocation_status;');for(const r of attempts)await sql(`insert into public.matter_invocation_status select * from jsonb_populate_record(null::public.matter_invocation_status,${q(r)});`);}
  if(user)assertSuccessful(await service.auth.admin.deleteUser(user),'delete status security user');
}
console.log(JSON.stringify({status:'passed',checks,realSqlAndDataApi:true,syntheticOnly:true,cleanup:'passed'}));
