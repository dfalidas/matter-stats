import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sanitizedEnvironment } from "../../scripts/stabilization-db-orchestrator.mjs";
import { REQUEST_TABLES,REQUEST_FUNCTION_SIGNATURES } from "../../scripts/matter-request-inventory.mjs";
import { assertSuccessful,assertGrantDenied } from "./supabase-security-assertions.mjs";
import { requestFixture } from "./matter-request-fixture.mjs";
assert.equal(process.env.DISPOSABLE_DB_ACK,"yes");
const project=process.env.STABILIZATION_TEST_SQL_PROJECT;assert.match(project,/^matter-stats-(fresh|upgrade)-[a-z0-9-]+$/);
const url=process.env.STABILIZATION_TEST_SUPABASE_URL;assert.ok(["127.0.0.1","localhost"].includes(new URL(url).hostname));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const service=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY,options);
const anon=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY,options);
const authenticated=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_ANON_KEY,options);
const sql=(statement)=>new Promise((resolve,reject)=>{const child=spawn("docker",["--host=unix:///var/run/docker.sock","exec","-i",`supabase_db_${project}`,"psql","-XAtq","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-f","-"],{env:sanitizedEnvironment(),stdio:["pipe","pipe","pipe"]});let out="",err="";child.stdout.on("data",c=>out+=c);child.stderr.on("data",c=>err+=c);child.on("error",reject);child.on("close",code=>code===0?resolve(out.trim()):reject(new Error(`Owned SQL failed: ${err}`)));child.stdin.end(statement);});
const rpc=async(name,args)=>{const r=await service.rpc(name,args);assertSuccessful(r,name);return r.data;};
const read=async(table)=>{const r=await service.from(table).select("*");assertSuccessful(r,table);return r.data;};
const hash=(value)=>createHash("sha256").update(value).digest("hex");
const admission=(key,extra={})=>({p_slot:"bootstrap",p_key:hash(key),p_markdown:false,p_recover:false,p_lease:null,...extra});
const leaseArgs=(lease)=>({p_account_scope:"matter",p_owner:lease.owner,p_generation:lease.generation});
const acquire=async()=>{const owner=crypto.randomUUID(),rows=await rpc("acquire_matter_sync_lease",{p_account_scope:"matter",p_owner:owner,p_ttl_seconds:120});assert.equal(rows.length,1);return {accountScope:"matter",owner,generation:rows[0].generation};};
const release=(lease)=>rpc("release_matter_sync_lease",leaseArgs(lease));
const env=sanitizedEnvironment({DISPOSABLE_DB_ACK:"yes",STABILIZATION_TEST_SUPABASE_URL:url,STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY:process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY});
const worker=(config)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,"tests/integration/matter-request-worker.mjs"),JSON.stringify(config)],{env,stdio:["ignore","pipe","pipe"]});let out="",err="";child.stdout.on("data",c=>out+=c);child.stderr.on("data",c=>err+=c);child.on("error",reject);child.on("close",code=>code===0?resolve(JSON.parse(out.trim().split(/\r?\n/).at(-1))):reject(new Error(err)));});
const page=(results=[],next=null)=>({object:"list",results,has_more:next!==null,next_cursor:next});
const prefix=`quota-${crypto.randomUUID()}`;
let fixture,originalStreams,originalIntent,originalRuns,originalDaily,authUser,lease,runtime;
const originalFetch=globalThis.fetch,originalResolve=Module._resolveFilename;
const checks=[];
try {
 fixture=await requestFixture(sql);await fixture.reset();originalStreams=await read("matter_sync_streams");originalIntent=(await read("matter_sync_continuation"))[0];originalRuns=new Set((await read("sync_runs")).map(r=>r.id));originalDaily=await read("daily_stats");
 // A pure production evaluator gives exact deterministic SQL boundaries, without
 // exposing a client-supplied clock on the mutating admission RPC.
 const base={account_scope:"matter",read_starts:Array(120).fill("2026-10-08T00:00:59.900Z"),burst_starts:Array(5).fill("2026-10-08T00:00:59.900Z"),markdown_starts:Array(20).fill("2026-10-08T00:00:59.900Z"),not_before:null,feedback_until:null,feedback_remaining:null};
 const evaluate=(now,markdown,state=base)=>rpc("evaluate_matter_quota",{p_state:state,p_now:now,p_markdown:markdown});
 const adjacent=await evaluate("2026-10-08T00:01:00.100Z",true);assert.equal(adjacent.read_starts.length,120);assert.equal(adjacent.burst_starts.length,5);assert.equal(Date.parse(adjacent.deadline),Date.parse("2026-10-08T00:01:59.900Z"));
 assert.equal((await evaluate("2026-10-08T00:01:00.899Z",false,{...base,read_starts:[],markdown_starts:[]})).burst_starts.length,5);
 assert.equal((await evaluate("2026-10-08T00:01:00.900Z",false,{...base,read_starts:[],markdown_starts:[]})).burst_starts.length,0);
 assert.equal((await evaluate("2026-10-08T00:01:59.899Z",true)).read_starts.length,120);
 const expired=await evaluate("2026-10-08T00:01:59.900Z",true);assert.equal(expired.read_starts.length,0);assert.equal(expired.markdown_starts.length,0);
 checks.push("Exact injected-clock production SQL rolling-window boundaries: adjacent minute/second buckets never replenish; expiry is precisely 60s/1s");
 // Independent server processes wait at an IPC barrier then compete for one row.
 const children=Array.from({length:16},(_,i)=>spawn(process.execPath,[path.join(root,"tests/integration/matter-request-worker.mjs"),JSON.stringify({admit:admission(`process-${i}`)})],{env,stdio:["ignore","ignore","pipe","ipc"]}));
 const ready=children.map(child=>new Promise((resolve,reject)=>{child.once("message",m=>m.ready?resolve():reject(new Error("worker not ready")));child.once("error",reject);child.once("exit",code=>{if(code!==null)reject(new Error("worker exited before barrier"));});}));
 const outcomes=children.map(child=>new Promise((resolve,reject)=>{child.on("message",m=>{if(m.result)resolve(m.result);});child.on("error",reject);child.on("exit",code=>{if(code!==0)reject(new Error("quota worker failed"));});}));
 await Promise.all(ready);for(const child of children)child.send({go:true});const contention=await Promise.all(outcomes);assert.equal(contention.filter(r=>r.admitted).length,5);assert.ok(contention.filter(r=>!r.admitted).every(r=>r.reason==="quota"));
 assert.equal((await read("matter_quota"))[0].sequence,5);checks.push("16 independent processes: exactly five burst admissions, eleven durable quota refusals, no over-admission");
 await fixture.reset();
 // Markdown consumes both quotas. Real Data API admission reserves one read and
 // one markdown; another process does not receive separate minute capacity.
 const mark=await rpc("admit_matter_request",admission("markdown",{p_markdown:true}));assert.equal(mark.admitted,true);let q=(await read("matter_quota"))[0];assert.equal(q.read_starts.length,1);assert.equal(q.markdown_starts.length,1);
 await sql("update public.matter_quota set burst_starts='{}',markdown_starts=array_fill(clock_timestamp(),array[20]) where account_scope='matter';");
 assert.equal((await rpc("admit_matter_request",admission("markdown-refused",{p_markdown:true}))).reason,"quota");assert.equal((await rpc("admit_matter_request",admission("ordinary-get"))).admitted,true);
 await sql("update public.matter_quota set burst_starts='{}',markdown_starts='{}',read_starts=array_fill(clock_timestamp(),array[120]) where account_scope='matter';");
 assert.equal((await rpc("admit_matter_request",admission("double-accounted",{p_markdown:true}))).reason,"quota");checks.push("Real markdown double-accounting and independent GET/markdown minute refusals");
 await fixture.reset();
 // Successful and failed HTTP headers restrict the SAME singleton; stale
 // observations subtract later reservations, never replenish or shorten cooldown.
 const first=await rpc("admit_matter_request",admission("feedback-a")),second=await rpc("admit_matter_request",admission("feedback-b"));
 const future=new Date(Date.now()+60000).toISOString(),later=new Date(Date.now()+90000).toISOString();
 await rpc("feedback_matter_request",{p_sequence:first.sequence,p_limit:120,p_remaining:2,p_reset:future,p_cooldown:later});q=(await read("matter_quota"))[0];assert.equal(q.feedback_remaining,1);
 await rpc("feedback_matter_request",{p_sequence:second.sequence,p_limit:120,p_remaining:119,p_reset:future,p_cooldown:future});let after=(await read("matter_quota"))[0];assert.equal(after.feedback_remaining,1);assert.equal(Date.parse(after.not_before),Date.parse(later));
 await rpc("feedback_matter_request",{p_sequence:first.sequence,p_limit:120,p_remaining:120,p_reset:"2000-01-01T00:00:00Z",p_cooldown:"2000-01-01T00:00:00Z"});assert.deepEqual((await read("matter_quota"))[0],after);
 checks.push("Real stale/concurrent header feedback cannot replenish remaining capacity or shorten account cooldown");
 for(const headers of [{"Retry-After":"60"},{"Retry-After":new Date(Date.now()+60000).toUTCString()},{"Retry-After":"-1","X-RateLimit-Remaining":"NaN","X-RateLimit-Reset":"12junk"}]) {
  await fixture.reset();const limited=await worker({headers});assert.equal(limited.requests,1);assert.equal(limited.outcome.status,429);const recreated=await worker({headers});assert.equal(recreated.requests,0);assert.equal(recreated.outcome.reason,"quota");q=(await read("matter_quota"))[0];assert.ok(Date.parse(q.not_before)>Date.now()+55000);
 }
 checks.push("Real /me admission: numeric/date/invalid Retry-After persists cooldown; recreated process performs zero upstream requests");
 await fixture.reset();const exhausted=await worker({status:503,headers:{}});assert.equal(exhausted.requests,3);assert.equal(exhausted.outcome.reason,"exhausted");assert.equal((await worker({status:503,headers:{}})).requests,0);
 await fixture.clearQuota();assert.equal((await worker({status:200,headers:{}})).requests,0,"expiring quota never resets retry exhaustion");checks.push("Eligible 503 chain exhausts at exactly three real admissions across fresh processes, independently of quota expiry");
 await fixture.reset();
 // Exercise the real production entry point for expensive durable preparation,
 // sibling fairness, last committed cursor and takeover fencing.
 process.env.SUPABASE_URL=url;process.env.SUPABASE_SERVICE_ROLE_KEY=process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY;process.env.MATTER_API_TOKEN="synthetic-never-sent";
 Module._resolveFilename=function(request,parent,isMain,options){if(request==="server-only")return path.join(root,"tests/fixtures/server-only.cjs");if(request.startsWith("@/"))return path.join(root,".test-build",`${request.slice(2)}.js`);return originalResolve.call(this,request,parent,isMain,options);};
 runtime=createRequire(import.meta.url)(path.join(root,".test-build/lib/matter-sync.js"));
 lease=await acquire();for(const state of originalStreams)await rpc("sync_upsert_stream",{...leaseArgs(lease),p_state:{...state,cycle_active:true,cursor:null,page_limit:100,cycle_started_at:"2026-10-08T00:00:00Z",cycle_generation:state.cycle_generation+1,filters:state.stream==="recent_sessions"?{}:{status:"all",order:"updated"},retry_at:null}});await rpc("turn_matter_continuation",{...leaseArgs(lease),p_stream:"library_items"});await release(lease);lease=null;
 const upstream=[];let failSessions=false;
 globalThis.fetch=async(input,init)=>{const u=new URL(String(input));if(u.hostname!=="api.getmatter.com")return originalFetch(input,init);upstream.push(u.href);
  if(u.pathname.endsWith("/me"))return Response.json({});
  if(u.pathname.endsWith("/reading_sessions"))return failSessions?Response.json({}, {status:503}):Response.json(page(Array.from({length:100},(_,i)=>({id:`${prefix}-session-${i}`,item_id:`${prefix}-item-${i}`,date:"2300-02-01T10:00:00Z",seconds_read:60}))));
  if(u.pathname.endsWith("/items"))return Response.json(page());
  if(u.pathname.endsWith("/annotations"))return Response.json(page());
  return Response.json({id:u.pathname.split("/").at(-1),title:"Synthetic",tags:[]});
 };
 const deps={...runtime.productionSyncDeps,now:()=>new Date()};
 const expensive=await runtime.syncMatterData("recent_activity_scheduled",{},deps);assert.equal(expensive.pagesCommitted,0);assert.equal(expensive.hasMore,true);assert.equal(expensive.requestsAttempted,120);assert.equal(expensive.ok,false);
 let state=(await read("matter_sync_streams")).find(s=>s.stream==="recent_sessions");assert.equal(state.cursor,null);const pinned={...state};let cache=(await read("matter_request_work")).find(w=>w.slot==="recent_sessions");assert.equal(Object.keys(cache.requests).length,119);
 const beforeResume=upstream.length;
 // Clock advance in this OWNED fixture: expire reservation timestamps and its
 // stream cooldown. Retain all caches, retry chains and pinned contracts.
 await sql("update public.matter_quota set read_starts=array(select t-interval '61 seconds' from unnest(read_starts) t),burst_starts=array(select t-interval '61 seconds' from unnest(burst_starts) t) where account_scope='matter'; update public.matter_sync_streams set retry_at=null where stream in ('recent_sessions','library_items');");
 const completed=await runtime.syncMatterData("recent_activity_scheduled",{},deps);assert.equal(completed.ok,true);assert.equal(completed.pagesCommitted,2);
 const newRequests=upstream.slice(beforeResume);assert.ok(newRequests[1].endsWith("/items?status=all&order=updated&limit=100"),"pending sibling gets first page after deferral");assert.equal(newRequests.filter(u=>u.includes("reading_sessions")).length,0,"session list preparation reused");assert.equal(upstream.filter(u=>u.includes("reading_sessions")).length,1);assert.equal(upstream.filter(u=>/\/items\/[^/]+$/.test(u)).length,100);assert.equal(upstream.filter(u=>u.includes("annotations")).length,100);
 state=(await read("matter_sync_streams")).find(s=>s.stream==="recent_sessions");assert.equal(state.cycle_generation,pinned.cycle_generation);assert.equal(state.page_limit,100);assert.equal(state.cycle_active,false);assert.equal(Date.parse(state.completed_watermark),Date.parse(pinned.cycle_started_at));assert.equal((await read("reading_sessions")).filter(s=>s.id.startsWith(prefix)).length,100);
 checks.push("Valid pinned 201-request page: first invocation uses exactly 120 admissions, retains 119 reads with zero ingestion; next invocation runs sibling then only missing reads and atomically commits all 100 sessions without changing limit/filters");
 // Exhausted preparation yields the same persisted sibling scheduling turn.
 await fixture.reset();lease=await acquire();for(const name of ["recent_sessions","library_items"]){const s=(await read("matter_sync_streams")).find(s=>s.stream===name);await rpc("sync_upsert_stream",{...leaseArgs(lease),p_state:{...s,cycle_active:true,cursor:null,cycle_started_at:new Date().toISOString(),cycle_generation:s.cycle_generation+1,retry_at:null}});}await rpc("turn_matter_continuation",{...leaseArgs(lease),p_stream:"library_items"});await release(lease);lease=null;failSessions=true;
 const failed=await runtime.syncMatterData("recent_activity_scheduled",{},deps);assert.equal(failed.ok,false);assert.equal(failed.pagesCommitted,0);const checkpoint=(await read("matter_sync_streams")).find(s=>s.stream==="recent_sessions");
 const sibling=await runtime.syncMatterData("recent_activity_scheduled",{},deps);assert.equal(sibling.pagesCommitted,1);assert.equal(sibling.ok,false);assert.equal(sibling.requestsAttempted,2);const retained=(await read("matter_sync_streams")).find(s=>s.stream==="recent_sessions");assert.equal(retained.cursor,checkpoint.cursor);assert.equal(retained.completed_watermark,checkpoint.completed_watermark);checks.push("Retry-exhausted page retains checkpoint and cannot starve pending sibling across recreated invocations");
 // Fenced preparation/admission/completion after lease takeover.
 lease=await acquire();const expected={...checkpoint};for(const k of ["created_at","updated_at"])delete expected[k];await rpc("prepare_matter_request_work",{...leaseArgs(lease),p_expected:expected});const reservation=await rpc("admit_matter_request",admission("fence",{p_slot:"recent_sessions",p_lease:leaseArgs(lease)}));assert.equal(reservation.admitted,true);const stale=lease;await sql(`update public.matter_sync_leases set expires_at=clock_timestamp()-interval '1 second' where owner='${lease.owner}';`);lease=await acquire();
 const beforeStale=await read("matter_request_work");for(const [name,args] of [["prepare_matter_request_work",{...leaseArgs(stale),p_expected:expected}],["admit_matter_request",admission("fence-retry",{p_slot:"recent_sessions",p_lease:leaseArgs(stale)})],["finish_matter_request",{p_slot:"recent_sessions",p_key:hash("fence"),p_sequence:reservation.sequence,p_entry:{value:page()},p_lease:leaseArgs(stale)}]])assert.equal((await service.rpc(name,args)).error.code,"55000");assert.deepEqual(await read("matter_request_work"),beforeStale);await release(lease);lease=null;checks.push("Real takeover fences all preparation/admission/cache writes; stale worker cannot complete or clear retry identity");
 // A→B→A across separate page commits is rejected transactionally.
 await fixture.reset();lease=await acquire();let cycle=(await read("matter_sync_streams")).find(s=>s.stream==="library_items");await rpc("sync_upsert_stream",{...leaseArgs(lease),p_state:{...cycle,cursor:null,cycle_active:true,cycle_started_at:new Date().toISOString(),cycle_generation:cycle.cycle_generation+1,retry_at:null}});
 const plan={placeholders:[],items:[],sessions:[],tags:[],itemTagIds:[],itemTags:[],annotations:[]};
 for(const next of ["loop-a","loop-b"]){cycle=(await read("matter_sync_streams")).find(s=>s.stream==="library_items");const e={...cycle};delete e.created_at;delete e.updated_at;await rpc("commit_matter_page",{...leaseArgs(lease),p_receipt_id:crypto.randomUUID(),p_previous_receipt_id:(await read("matter_page_receipts")).find(r=>r.stream==="library_items")?.receipt_id??null,p_expected:e,p_plan:plan,p_has_more:true,p_next_cursor:next,p_timezone:"UTC"});}
 cycle=(await read("matter_sync_streams")).find(s=>s.stream==="library_items");const e={...cycle};delete e.created_at;delete e.updated_at;const receipts=await read("matter_page_receipts");const loop=await service.rpc("commit_matter_page",{...leaseArgs(lease),p_receipt_id:crypto.randomUUID(),p_previous_receipt_id:receipts.find(r=>r.stream==="library_items").receipt_id,p_expected:e,p_plan:plan,p_has_more:true,p_next_cursor:"loop-a",p_timezone:"UTC"});assert.equal(loop.error.code,"22023");assert.deepEqual(await read("matter_page_receipts"),receipts);assert.deepEqual((await read("matter_sync_streams")).find(s=>s.stream==="library_items"),cycle);await release(lease);lease=null;checks.push("Cross-invocation A/B/A cursor loop rolls back effects, receipt and checkpoint in the existing page transaction");
 // Valid browser roles and service controls for every new table/function.
 const password=`T-${crypto.randomUUID()}-aA1!`,email=`${prefix}@example.invalid`;const created=await service.auth.admin.createUser({email,password,email_confirm:true});assertSuccessful(created,"owned Auth");authUser=created.data.user.id;assertSuccessful(await authenticated.auth.signInWithPassword({email,password}),"valid authenticated browser role");
 for(const [role,client] of [["anon",anon],["authenticated",authenticated]]) {
  for(const table of REQUEST_TABLES){const row=(await read(table))[0],column=table==="matter_quota"?"account_scope":"slot";for(const [operation,query] of [["SELECT",client.from(table).select("*")],["INSERT",client.from(table).insert(row)],["UPDATE",client.from(table).update(row).eq(column,row[column])],["DELETE",client.from(table).delete().eq(column,row[column])]])assertGrantDenied(await query,{role,operation,kind:"table",name:table});}
  const payloads={evaluate_matter_quota:{p_state:base,p_now:"2026-10-08T00:01:00Z",p_markdown:true},prepare_matter_request_work:{p_account_scope:"matter",p_owner:crypto.randomUUID(),p_generation:"1",p_expected:{}},admit_matter_request:admission("denied"),feedback_matter_request:{p_sequence:"1",p_limit:120,p_remaining:0,p_reset:future,p_cooldown:future},finish_matter_request:{p_slot:"bootstrap",p_key:hash("denied"),p_sequence:"1",p_entry:{value:{}},p_lease:null}};
  for(const signature of REQUEST_FUNCTION_SIGNATURES){const name=signature.split("(")[0];if(name==="track_matter_page_cursors")await sql(`begin; set local role ${role}; do $deny$ begin perform public.track_matter_page_cursors(); raise exception 'unexpected execution'; exception when insufficient_privilege then if sqlerrm<>'permission denied for function track_matter_page_cursors' then raise; end if; end; $deny$; rollback;`);else assertGrantDenied(await client.rpc(name,payloads[name]),{role,operation:"EXECUTE",kind:"function",name});}
 }
 for(const table of REQUEST_TABLES){const row=(await read(table))[0];assert.ok((await service.from(table).insert(row)).error,"service cannot insert/reset singleton");assert.equal((await service.from(table).delete().eq(table==="matter_quota"?"account_scope":"slot",table==="matter_quota"?"matter":"bootstrap")).error.code,"42501");}
 checks.push("Valid anon/authenticated CRUD and all exact RPC/trigger denials; service-only evaluation/reservation/feedback/fenced writes; singleton reset and deletion denied");
} finally {
 globalThis.fetch=originalFetch;Module._resolveFilename=originalResolve;
 if(lease)await release(lease);
 if(originalStreams){lease=await acquire();try {
  for(const state of originalStreams)await rpc("sync_upsert_stream",{...leaseArgs(lease),p_state:state});assertSuccessful(await service.from("matter_sync_continuation").update(originalIntent).eq("account_scope","matter"),"restore intent");
  await sql(`delete from public.matter_page_receipts where stream in ('recent_sessions','library_items'); delete from public.matter_dirty_rollups where date='2300-02-01'; delete from public.daily_stats where date='2300-02-01'; delete from public.reading_sessions where id like '${prefix}%'; delete from public.matter_items where id like '${prefix}%';`);
  for(const row of originalDaily) {if(row.date!=="2300-02-01")continue;assertSuccessful(await service.from("daily_stats").insert(row),"restore preexisting rollup");}
  const runs=(await read("sync_runs")).filter(r=>!originalRuns.has(r.id));if(runs.length)assertSuccessful(await service.from("sync_runs").delete().in("id",runs.map(r=>r.id)),"owned runs cleanup");
 }finally{await release(lease);lease=null;}}
 if(fixture)await fixture.restore();if(authUser)assertSuccessful(await service.auth.admin.deleteUser(authUser),"Auth cleanup");
 if(originalStreams){assert.equal(await sql(`select count(*) from public.reading_sessions where id like '${prefix}%';`),"0");assert.deepEqual((await read("daily_stats")).sort((a,b)=>a.date.localeCompare(b.date)),originalDaily.sort((a,b)=>a.date.localeCompare(b.date)));assert.equal((await read("matter_sync_leases"))[0].owner,null);}
}
console.log(JSON.stringify({status:"passed",checks,realSqlAndDataApi:true,syntheticMatterOnly:true,cleanup:"passed"}));
