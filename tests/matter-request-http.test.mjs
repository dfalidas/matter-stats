import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,isMain,options) {
 if(request==="server-only") return path.join(root,"tests/fixtures/server-only.cjs");
 if(request.startsWith("@/")) return path.join(root,".test-build",`${request.slice(2)}.js`);
 return resolve.call(this,request,parent,isMain,options);
};
const require=createRequire(import.meta.url);
const api=require(path.join(root,".test-build/lib/matter-api.js"));
const coordinator=require(path.join(root,".test-build/lib/matter-request-coordinator.js"));
const { MatterInvocationBudget, withMatterInvocationBudget }=require(path.join(root,".test-build/lib/matter-invocation-budget.js"));
process.env.MATTER_API_TOKEN="synthetic-never-sent";
function harness() {
 let now=Date.parse("2026-10-08T00:00:00Z"),seq=0,cooldown=0;
 const entries=new Map(),events=[];
 const runtime={ now:()=>now, random:()=>0, wait:async(ms,signal)=>{signal?.throwIfAborted();events.push(["wait",ms]);now+=ms;},store:{
  admit:async(args)=>{
   events.push(["admit",args.p_slot,args.p_markdown]); const key=args.p_slot+args.p_key;let r=entries.get(key)??{attempts:0};
   if(args.p_recover && (r.protocol || (r.status && ![403,404].includes(r.status))) && now>=r.next) r={attempts:0};
   if("value" in r || "status" in r || "protocol" in r) return { admitted:false,reason:"cached",entry:r };
   if(r.pending && !(args.p_recover && now>=r.next)) return { admitted:false,reason:"exhausted",next_at:new Date(r.next).toISOString() };
   if(r.attempts>=3 && !(args.p_recover && now>=r.next)) return { admitted:false,reason:"exhausted",next_at:new Date(r.next).toISOString() };
   if(now<cooldown) return { admitted:false,reason:"quota",next_at:new Date(cooldown).toISOString() };
   if(now<(r.next??0)) return { admitted:false,reason:"retry",next_at:new Date(r.next).toISOString() };
   const attempt=r.attempts>=3?1:r.attempts+1,sequence=String(++seq); entries.set(key,{attempts:attempt,next:now+900000,sequence,pending:true});
   return { admitted:true,sequence,attempt };
  },
  feedback:async(args)=>{events.push(["feedback",args]); if(args.p_cooldown) cooldown=Math.max(cooldown,Date.parse(args.p_cooldown));},
  finish:async(args)=>{
   events.push(["finish",args.p_entry]);const key=args.p_slot+args.p_key,r=entries.get(key),entry=args.p_entry;
   assert.equal(args.p_sequence,r.sequence,"outcome uses the reserved sequence");
   delete r.pending;
   if("transient_delay_ms" in entry) r.next=now+(r.attempts>=3?900000:entry.transient_delay_ms);
   else if(entry.quota) {r.next=now+(r.attempts>=3?900000:0);}
   else if(args.p_slot==="bootstrap" && "value" in entry) entries.delete(key);
   else Object.assign(r,entry);
  }
 }};
 return { runtime,events,entries,advance:(ms)=>now+=ms,run:(work,budget=new MatterInvocationBudget())=>coordinator.withMatterRequestRuntime({...runtime},()=>withMatterInvocationBudget(budget,work)) };
}
const page=(next=null)=>({object:"list",results:[],has_more:next!==null,next_cursor:next});
async function synthetic(t,fetcher,work) {const previous=globalThis.fetch;globalThis.fetch=fetcher;t.after(()=>globalThis.fetch=previous);await work();}
test("Task 15: /me and each eligible retry require admission and consume actual request budget",async(t)=>{
 const h=harness();let requests=0;const budget=new MatterInvocationBudget();
 await synthetic(t,async()=>{requests++;return requests<3?Response.json({}, {status:503}):Response.json({object:"account",id:"synthetic-account"});},async()=>{
  await h.run(()=>api.getMatterAccount(),budget);
  assert.equal(requests,3);assert.equal(budget.requests,3);
  assert.equal(h.events.filter((e)=>e[0]==="admit").length,5);
  assert.deepEqual(h.events.filter((e)=>e[0]==="wait").map((e)=>e[1]),[500,1000]);
 });
});
test("Task 15: automatic retry chain cannot replenish across recreated invocation runtimes",async(t)=>{
 const h=harness();let requests=0;
 await synthetic(t,async()=>{requests++;throw new TypeError("synthetic reset",{cause:{code:"ECONNRESET"}});},async()=>{
  for(let i=0;i<3;i++) {const b=new MatterInvocationBudget({...require(path.join(root,".test-build/lib/matter-invocation-budget.js")).MATTER_INVOCATION_LIMITS,requests:1});await assert.rejects(h.run(()=>api.getMatterAccount(),b));h.advance(2000);}
  assert.equal(requests,3);
  await assert.rejects(h.run(()=>api.getMatterAccount()),/exhausted/);assert.equal(requests,3);
  h.advance(900000);
  await assert.rejects(h.run(()=>api.getMatterAccount()),/exhausted/);assert.equal(requests,3,"cron never resets chain");
  await assert.rejects(h.run(()=>coordinator.withMatterRequestContext({slot:"bootstrap",recover:true},()=>api.getMatterAccount())),/exhausted/);assert.equal(requests,6,"one deliberate recovery remains three attempts");
 });
});
test("Task 15: request timeout stops at exactly three attempts",async(t)=>{
 const h=harness();let requests=0;const budget=new MatterInvocationBudget({...require(path.join(root,".test-build/lib/matter-invocation-budget.js")).MATTER_INVOCATION_LIMITS,requestMs:5});
 await synthetic(t,async()=>{requests++;return new Promise(()=>{});},async()=>{
  await assert.rejects(h.run(()=>api.getMatterAccount(),budget),/exhausted/);assert.equal(requests,3);assert.equal(budget.requests,3);
 });
});
test("Task 15: 429 feedback survives recreation; quota refusal makes zero HTTP calls",async(t)=>{
 for(const retry of ["60","Thu, 08 Oct 2026 00:01:00 GMT","60junk"]) {
  const h=harness();let requests=0;
  await synthetic(t,async()=>{requests++;return Response.json({}, {status:429,headers:{"Retry-After":retry,"X-RateLimit-Limit":"120","X-RateLimit-Remaining":"0","X-RateLimit-Reset":String(h.runtime.now()/1000+90)}});},async()=>{
   await assert.rejects(h.run(()=>api.getMatterAccount()),api.MatterRateLimitError);
   await assert.rejects(h.run(()=>api.getMatterAccount()),/deferred/);assert.equal(requests,1);
   assert.equal(Date.parse(h.events.find((e)=>e[0]==="feedback")[1].p_cooldown),h.runtime.now()+90000);
  });
 }
});
test("Task 15: authentication/validation errors never loop; optional endpoint errors retain classification",async(t)=>{
 for(const status of [400,401,403,404,422,501]) {const h=harness();let requests=0;
  await synthetic(t,async()=>{requests++;return Response.json({}, {status});},async()=>{
   await assert.rejects(h.run(()=>api.getMatterItem("fixture")),(error)=>error.status===status);
   await assert.rejects(h.run(()=>api.getMatterItem("fixture")),(error)=>error.status===status);
   assert.equal(requests,1);
  });
 }
});
test("Task 15: invalid JSON/envelopes and missing or looping annotation cursors never exhaust successfully",async(t)=>{
 for(const value of ["malformed",{}, {...page(),has_more:true}, {...page(),has_more:true,next_cursor:""}]) {const h=harness();let requests=0;
  await synthetic(t,async()=>{requests++;return typeof value==="string"?new Response(value):Response.json(value);},async()=>{await assert.rejects(h.run(()=>api.listMatterReadingSessions()),/page rejected/i);assert.equal(requests,1);});
 }
 const h=harness();let requests=0;
 await synthetic(t,async()=>{requests++;return Response.json(page(requests===1?"a":"a"));},async()=>{await assert.rejects(h.run(()=>api.collectMatterPages((cursor)=>api.listMatterAnnotations("fixture",{cursor}))),/page rejected/i);assert.equal(requests,2);});
});
test("Task 15: lease loss after short wait and caller cancellation prevent another HTTP attempt",async(t)=>{
 const h=harness();let requests=0,lost=false;h.runtime.wait=async()=>{lost=true;};
 await synthetic(t,async()=>{requests++;return Response.json({}, {status:500});},async()=>{
  await assert.rejects(h.run(()=>api.getMatterAccount(async()=>{if(lost)throw new Error("synthetic lost lease");})),/lost lease/);assert.equal(requests,1);
  const abort=new AbortController();abort.abort(new Error("caller canceled"));
  await assert.rejects(h.run(()=>api.matterFetch("/me",{signal:abort.signal})),/caller canceled/);assert.equal(requests,1);
 });
});
test("Task 15: an ambiguous preparation database write is never automatically retried",async(t)=>{
 const h=harness();let requests=0;h.runtime.store.finish=async()=>{throw new TypeError("ambiguous DB response",{cause:{code:"ECONNRESET"}});};
 await synthetic(t,async()=>{requests++;return Response.json({object:"account",id:"synthetic-account"});},async()=>{await assert.rejects(h.run(()=>api.getMatterAccount()),/ambiguous DB/);assert.equal(requests,1);});
});
test("Task 15: quota verification and feedback write failures fail closed without HTTP retries",async(t)=>{
 const h=harness();let requests=0;
 await synthetic(t,async()=>{requests++;return Response.json({object:"account",id:"synthetic"});},async()=>{
  h.runtime.store.admit=async()=>{throw new Error("unavailable admission");};
  await assert.rejects(h.run(()=>api.getMatterAccount()),/unavailable admission/);assert.equal(requests,0);
  h.runtime.store.admit=async()=>({admitted:true,sequence:"1",attempt:1});
  h.runtime.store.feedback=async()=>{throw new TypeError("ambiguous feedback",{cause:{code:"ECONNRESET"}});};
  await assert.rejects(h.run(()=>api.getMatterAccount()),/feedback could not be verified/);assert.equal(requests,1);
 });
});
test("Task 15: malformed account and error envelopes cannot disguise authentication failure",async(t)=>{
 const h=harness();let requests=0;
 await synthetic(t,async()=>{requests++;return Response.json({});},async()=>{await assert.rejects(h.run(()=>api.getMatterAccount()),/page rejected/i);await assert.rejects(h.run(()=>api.getMatterAccount()),/page rejected/i);assert.equal(requests,1);});
 const h2=harness();requests=0;
 await synthetic(t,async()=>{requests++;return Response.json(null,{status:401});},async()=>{await assert.rejects(h2.run(()=>api.getMatterAccount()),e=>e.status===401);await assert.rejects(h2.run(()=>api.getMatterAccount()),e=>e.status===401);assert.equal(requests,1);});
});
test("Task 15: unclassified transport errors never become automatic retries after recreation",async(t)=>{
 const h=harness();let requests=0;
 await synthetic(t,async()=>{requests++;throw new TypeError("unclassified network failure");},async()=>{
  await assert.rejects(h.run(()=>api.getMatterAccount()),/page rejected/i);h.advance(900001);
  await assert.rejects(h.run(()=>api.getMatterAccount()),/page rejected/i);assert.equal(requests,1);
 });
});
test("Task 15: a timed-out authentication error body never triggers another request",async(t)=>{
 for(const status of [400,401,403,422,429]) {const h=harness();let requests=0;
  const budget=new MatterInvocationBudget({...require(path.join(root,".test-build/lib/matter-invocation-budget.js")).MATTER_INVOCATION_LIMITS,requestMs:5});
  await synthetic(t,async()=>{requests++;return new Response(new ReadableStream({start(){}}),{status});},async()=>{
   await assert.rejects(h.run(()=>api.getMatterAccount(),budget),e=>e.status===status);
   await assert.rejects(h.run(()=>api.getMatterAccount()),e=>status===429?e.reason==="quota":e.status===status);assert.equal(requests,1);
  });
 }
});
test("P1: item/tag semantics are rejected before successful preparation caching",async(t)=>{
 for(const [path,value] of [["/items",{...page(),results:[{}]}],["/items",{...page(),results:[{id:"bad",tags:[{}]}]}],["/items/bad",{id:"bad",tags:{}}],["/items/bad",{id:"different",tags:[]}],["/reading_sessions",{...page(),results:[{id:"s",date:"2300-02-01T10:00:00Z",seconds_read:60,item:{id:"bad",tags:[{}]}}]}]]) {
  const h=harness();let requests=0;
  await synthetic(t,async()=>{requests++;return Response.json(value);},async()=>{
   await assert.rejects(h.run(()=>coordinator.withMatterRequestContext({slot:"library_items",recover:false},()=>api.matterFetch(path))),/page rejected/i);
   const entry=[...h.entries.values()][0];assert.equal(entry.protocol,true);assert.equal("value" in entry,false);assert.equal(requests,1);
  });
 }
});
test("P1: legacy rejected values recover only deliberately after eligibility; unrelated valid reads survive",async(t)=>{
 const h=harness();let requests=0;const run=()=>h.run(()=>coordinator.withMatterRequestContext({slot:"library_items",recover:true},()=>api.listMatterItems()));
 await synthetic(t,async()=>{requests++;return Response.json({...page(),results:[{id:"corrected",tags:[]}]});},async()=>{
  // Seed exactly the previously accepted cache shape, including its RPC sequence.
  await run();const [key,entry]=[...h.entries.entries()][0];entry.value={...page(),results:[{id:"corrected",tags:[{}]}]};
  const valid={sequence:"99",attempts:1,value:page(),next:h.runtime.now()+900000};h.entries.set("unrelated",valid);
  await assert.rejects(run(),/page rejected/i);assert.equal(entry.protocol,true);assert.equal(entry.value,null);assert.equal(requests,1,"quarantine uses no HTTP");
  await assert.rejects(run(),/page rejected/i);assert.equal(requests,1,"early manual recovery remains blocked");
  h.advance(900001);
  await assert.rejects(h.run(()=>coordinator.withMatterRequestContext({slot:"library_items",recover:false},()=>api.listMatterItems())),/page rejected/i);assert.equal(requests,1,"cron never resets a protocol failure");
  assert.equal((await run()).results[0].id,"corrected");assert.equal(requests,2);assert.deepEqual(h.entries.get("unrelated"),valid);
  assert.equal(h.entries.get(key).protocol,undefined);assert.equal(h.entries.get(key).attempts,1);
 });
});
test("P1: cached rejection cannot write after lease loss or an unverifiable sequence",async(t)=>{
 for(const missingSequence of [false,true]) {const h=harness();let requests=0,renewals=0;
  await synthetic(t,async()=>{requests++;return Response.json({...page(),results:[{id:"fixture",tags:[]}]});},async()=>{
   const context=work=>coordinator.withMatterRequestContext({slot:"library_items",recover:false},work);
   await h.run(()=>context(()=>api.listMatterItems()));const entry=[...h.entries.values()][0];entry.value={...page(),results:[{}]};if(missingSequence)delete entry.sequence;
   const writes=h.events.filter(e=>e[0]==="finish").length;
   await assert.rejects(h.run(()=>context(()=>api.listMatterItems({},async()=>{if(++renewals===3)throw new Error("synthetic lost lease");}))),missingSequence?/Unverified cached/:/lost lease/);
   assert.equal(entry.protocol,undefined);assert.equal(requests,1);assert.equal(h.events.filter(e=>e[0]==="finish").length,writes);
  });
 }
});

test("26A: lease renewal consuming the residual budget must stop before reservation",async(t)=>{
 const h=harness();let now=0,requests=0;
 const budget=new MatterInvocationBudget(undefined,()=>now);
 await synthetic(t,async()=>{requests++;return Response.json(page());},async()=>{
  now=69_999;
  await assert.rejects(h.run(()=>api.listMatterItems({},async()=>{now=90_000;}),budget),/deadline/);
  assert.equal(h.events.filter(e=>e[0]==="admit").length,0);
  assert.equal(h.entries.size,0);assert.equal(requests,0);
 });
});
test("26A: validated response at the deadline is finalized and reused by scheduled continuation",async(t)=>{
 const h=harness();let now=0,requests=0;
 const budget=new MatterInvocationBudget(undefined,()=>now);
 await synthetic(t,async()=>{requests++;now=90_000;return Response.json(page());},async()=>{
  await h.run(()=>coordinator.withMatterRequestContext({slot:"library_items",recover:false},()=>api.listMatterItems()),budget);
  const entry=[...h.entries.values()][0];assert.deepEqual(entry.value,page());assert.equal(entry.attempts,1);
  await h.run(()=>coordinator.withMatterRequestContext({slot:"library_items",recover:false},()=>api.listMatterItems()));
  assert.equal(requests,1,"fresh scheduled context reuses successful preparation");
 });
});

test("26A: residual time refuses reservation even before the deadline",async(t)=>{
 const h=harness();let now=0;
 const budget=new MatterInvocationBudget(undefined,()=>now);
 await synthetic(t,()=>{throw new Error("must not fetch");},async()=>{
  now=70_000;
  await assert.rejects(h.run(()=>api.listMatterItems(),budget),/deadline/);
  assert.equal(h.entries.size,0);assert.equal(budget.requests,0);
 });
});
test("26A: lost lease, cancellation and ambiguous finalization remain blocked after eligibility",async(t)=>{
 for(const failure of ["lease","cancel","database"]) {
  const h=harness();let requests=0,renewals=0;const abort=new AbortController();
  const context=work=>coordinator.withMatterRequestContext({slot:"library_items",recover:false},work);
  const before=async()=>{if(failure==="lease" && ++renewals===2) throw new Error("lost lease");};
  if(failure==="database")h.runtime.store.finish=async()=>{throw new Error("ambiguous database");};
  await synthetic(t,async()=>{requests++;if(failure==="cancel")abort.abort(new Error("cancelled"));return Response.json(page());},async()=>{
   await assert.rejects(h.run(()=>context(()=>api.matterFetch("/items",{beforeRequest:before,signal:abort.signal}))));
   const entry=[...h.entries.values()][0];assert.equal(entry.pending,true);assert.equal(entry.attempts,1);
   h.advance(900001);
   await assert.rejects(h.run(()=>context(()=>api.listMatterItems())),/exhausted/);
   assert.equal(requests,failure==="lease"?0:1);
  });
 }
});
test("26A: timed-out renewal cannot launch late upstream work",async(t)=>{
 const h=harness();let renewals=0,release,requests=0;
 const budget=new MatterInvocationBudget({...require(path.join(root,".test-build/lib/matter-invocation-budget.js")).MATTER_INVOCATION_LIMITS,requestMs:5,requests:1});
 await synthetic(t,async()=>{requests++;return Response.json(page());},async()=>{
  const work=h.run(()=>api.listMatterItems({},async()=>{if(++renewals===2)await new Promise(resolve=>{release=resolve;});}),budget);
  await assert.rejects(work,/requests/);
  const before=requests; release(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests,before,"expired work cannot fetch after renewal resolves");
 });
});
