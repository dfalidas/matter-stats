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
   events.push(["admit",args.p_slot,args.p_markdown]); const key=args.p_slot+args.p_key,r=entries.get(key)??{attempts:0};
   if("value" in r || "status" in r || "protocol" in r) return { admitted:false,reason:"cached",entry:r };
   if(r.attempts>=3 && !(args.p_recover && now>=r.next)) return { admitted:false,reason:"exhausted",next_at:new Date(r.next).toISOString() };
   if(now<cooldown) return { admitted:false,reason:"quota",next_at:new Date(cooldown).toISOString() };
   if(now<(r.next??0)) return { admitted:false,reason:"retry",next_at:new Date(r.next).toISOString() };
   const attempt=r.attempts>=3?1:r.attempts+1; entries.set(key,{attempts:attempt,next:now+900000});
   return { admitted:true,sequence:String(++seq),attempt };
  },
  feedback:async(args)=>{events.push(["feedback",args]); if(args.p_cooldown) cooldown=Math.max(cooldown,Date.parse(args.p_cooldown));},
  finish:async(args)=>{
   events.push(["finish",args.p_entry]);const key=args.p_slot+args.p_key,r=entries.get(key),entry=args.p_entry;
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
 for(const status of [400,401,403,404,422]) {const h=harness();let requests=0;
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
