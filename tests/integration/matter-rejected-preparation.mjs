import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const hash=value=>createHash("sha256").update(value).digest("hex");
const page=results=>({object:"list",results,has_more:false,next_cursor:null});
const leaseArgs=lease=>({p_account_scope:"matter",p_owner:lease.owner,p_generation:lease.generation});
const ingestionTables=["matter_items","matter_tags","item_tags","annotations","reading_sessions","daily_stats","matter_dirty_rollups","matter_page_receipts"];

// Real production sync, SQL admission/cache/commit RPCs and Data API. Only Matter
// HTTP is synthetic. The fixture owns both streams and restores them externally.
export async function verifyRejectedPreparation({runtime,deps,fixture,sql,read,rpc,acquire,release,prefix,originalFetch}) {
 const checks=[];
 const cases=[
  {kind:"library",malformed:"item"},{kind:"library",malformed:"tag"},
  {kind:"linked",malformed:"item"},{kind:"linked",malformed:"tag"},
  {kind:"embedded",malformed:"tag"},
  {kind:"library",malformed:"tag",legacy:true},
  {kind:"linked",malformed:"tag",legacy:true},
  {kind:"embedded",malformed:"tag",legacy:true},
 ];
 const previousFetch=globalThis.fetch;
 const startingStreams=await read("matter_sync_streams");
 try {for(const [index,scenario] of cases.entries()) {
  await fixture.reset();
  const stream=scenario.kind==="library"?"library_items":"recent_sessions",other=stream==="library_items"?"recent_sessions":"library_items";
  const stem=`${prefix}-rejected-${index}`,badId=`${stem}-bad`,goodId=`${stem}-good`,cursor=`p1:${index}`;
  const validBad={id:badId,title:"Corrected",tags:[]},good={id:goodId,title:"Retained",tags:[]};
  const bad=scenario.malformed==="item"?{title:"Missing identity",tags:[]}:{...validBad,tags:[{}]};
  const sessions=corrected=>page([
   {id:`${stem}-session-good`,item_id:goodId,date:"2300-02-01T10:00:00Z",seconds_read:60},
   {id:`${stem}-session-bad`,item_id:badId,date:"2300-02-01T10:00:00Z",seconds_read:60,...(scenario.kind==="embedded"?{item:corrected?validBad:bad}:{})},
  ]);
  const listUrl=new URL(`https://api.getmatter.com/public/v1/${scenario.kind==="library"?"items":"reading_sessions"}`);
  listUrl.search=new URLSearchParams(scenario.kind==="library"?{status:"all",order:"updated",limit:"100",cursor}:{limit:"100",cursor}).toString();
  const rejectedUrl=scenario.kind==="linked"?`https://api.getmatter.com/public/v1/items/${badId}`:listUrl.href;
  let lease=await acquire();
  try {
   for(const s of await read("matter_sync_streams")) await rpc("sync_upsert_stream",{...leaseArgs(lease),p_state:{...s,cycle_active:true,cursor:s.stream===stream?cursor:null,page_limit:100,cycle_started_at:new Date().toISOString(),cycle_generation:s.cycle_generation+1,filters:s.stream==="library_items"?{status:"all",order:"updated"}:{},retry_at:null}});
   const seed=async(slot,url,value)=>{
    const state=(await read("matter_sync_streams")).find(s=>s.stream===slot);await rpc("prepare_matter_request_work",{...leaseArgs(lease),p_expected:state});
    const reservation=await rpc("admit_matter_request",{p_slot:slot,p_key:hash(url),p_markdown:false,p_recover:false,p_lease:leaseArgs(lease)});assert.equal(reservation.admitted,true);
    await rpc("finish_matter_request",{p_slot:slot,p_key:hash(url),p_sequence:reservation.sequence,p_entry:{value},p_lease:leaseArgs(lease)});
   };
   // Keep a sibling's unrelated successful preparation intact throughout failure
   // and recovery. A fenced turn selects the target; the one-page budget leaves
   // this sibling active for the separate existing fairness scenarios.
   await seed(other,`https://api.getmatter.com/public/v1/items/${stem}-unrelated`,{id:`${stem}-unrelated`,tags:[]});
   if(scenario.legacy) {
    if(scenario.kind==="linked") {await seed(stream,listUrl.href,sessions(true));await seed(stream,`https://api.getmatter.com/public/v1/items/${goodId}`,good);}
    await seed(stream,rejectedUrl,scenario.kind==="library"?page([bad]):scenario.kind==="embedded"?sessions(false):bad);
   }
  } finally {await release(lease);}
  await fixture.clearQuota();
  const pinned=(await read("matter_sync_streams")).find(s=>s.stream===stream);
  const unrelated=(await read("matter_request_work")).find(w=>w.slot===other);
  const intent=(await read("matter_sync_continuation"))[0];
  const before=new Map(await Promise.all(ingestionTables.map(async table=>[table,await read(table)])));
  let corrected=false;const upstream=[];
  globalThis.fetch=async(input,init)=>{
   const url=new URL(String(input));if(url.hostname!=="api.getmatter.com")return originalFetch(input,init);upstream.push(url.href);
   if(url.pathname.endsWith("/me"))return Response.json({object:"account",id:"synthetic-account"});
   if(url.href===listUrl.href)return Response.json(scenario.kind==="library"?page([corrected?validBad:bad]):sessions(corrected));
   if(url.pathname.endsWith("/annotations"))return Response.json(page([]));
   if(url.pathname.endsWith(`/${goodId}`))return Response.json(good);
   if(url.href===rejectedUrl)return Response.json(corrected?validBad:bad);
   throw new Error("Unexpected synthetic Matter request");
  };
  const invoke=async mode=>{
   const lease=await acquire();try{await rpc("turn_matter_continuation",{...leaseArgs(lease),p_stream:other});}finally{await release(lease);}
   return runtime.syncMatterData(mode,{budget:{pages:1,requests:224,upstreamMs:90000,totalMs:150000,requestMs:10000}},deps);
  };
  const manual=scenario.kind==="library"?"backfill_library":"recent_activity_manual";
  const assertUncommitted=async result=>{
   assert.equal(result.ok,false);assert.equal(result.hasMore,true);assert.equal(result.pagesCommitted,0);
   assert.deepEqual((await read("matter_sync_streams")).find(s=>s.stream===stream),pinned,"no cursor/cycle/watermark change");
   const current=(await read("matter_sync_continuation"))[0];for(const key of Object.keys(intent).filter(key=>key.startsWith("history_")))assert.deepEqual(current[key],intent[key]);
   for(const [table,rows] of before)assert.deepEqual(await read(table),rows,`${table}: rejected preparation has no effects`);
   assert.deepEqual((await read("matter_request_work")).find(w=>w.slot===other),unrelated);
  };
  await assertUncommitted(await invoke(manual));
  let work=(await read("matter_request_work")).find(w=>w.slot===stream),rejected=work.requests[hash(rejectedUrl)];
  assert.equal(rejected.protocol,true);assert.equal("value" in rejected,Boolean(scenario.legacy));
  if(scenario.legacy)assert.equal(rejected.value,null,"discard rejected payload without growing the bounded cache");
  assert.equal(upstream.filter(url=>url===rejectedUrl).length,scenario.legacy?0:1);
  const retained=Object.fromEntries(Object.entries(work.requests).filter(([key])=>key!==hash(rejectedUrl)));
  corrected=true;await fixture.clearQuota();await assertUncommitted(await invoke(manual));
  assert.equal(upstream.filter(url=>url===rejectedUrl).length,scenario.legacy?0:1,"manual cannot recover before recorded eligibility");
  // Advance only this owned request's eligibility, as if 15 minutes elapsed.
  // Keep every valid prepared read, retry count and pinned stream field intact.
  await sql(`update public.matter_request_work set requests=jsonb_set(requests,array['${hash(rejectedUrl)}','next_at'],to_jsonb(clock_timestamp()-interval '1 second')) where slot='${stream}';`);
  if(stream==="recent_sessions") {await fixture.clearQuota();await assertUncommitted(await invoke("recent_activity_scheduled"));}
  work=(await read("matter_request_work")).find(w=>w.slot===stream);
  assert.deepEqual(Object.fromEntries(Object.entries(work.requests).filter(([key])=>key!==hash(rejectedUrl))),retained);
  await fixture.clearQuota();const success=await invoke(manual);assert.equal(success.ok,true);assert.equal(success.pagesCommitted,1);
  assert.equal(upstream.filter(url=>url===rejectedUrl).length,scenario.legacy?1:2,"corrected request fetched exactly once for deliberate recovery");
  if(scenario.kind==="linked") {
   assert.equal(upstream.filter(url=>url===listUrl.href).length,scenario.legacy?0:1,"valid session list reused");
   assert.equal(upstream.filter(url=>url.endsWith(`/items/${goodId}`)).length,scenario.legacy?0:1,"valid linked lookup reused");
  }
  const committed=(await read("matter_sync_streams")).find(s=>s.stream===stream);
  assert.equal(committed.cycle_active,false);assert.equal(committed.cycle_generation,pinned.cycle_generation);assert.equal(committed.page_limit,pinned.page_limit);assert.deepEqual(committed.filters,pinned.filters);assert.equal(Date.parse(committed.completed_watermark),Date.parse(pinned.cycle_started_at));
  assert.ok((await read("matter_items")).some(item=>item.id===badId));
  if(stream==="recent_sessions")assert.equal((await read("reading_sessions")).filter(s=>s.id.startsWith(stem)).length,2);
  assert.deepEqual((await read("matter_request_work")).find(w=>w.slot===other),unrelated);
  checks.push(`P1 production sync ${scenario.kind}/${scenario.malformed}/${scenario.legacy?"legacy cached":"new response"}: rejection has zero ingestion/completion, recorded manual eligibility recovers corrected upstream, valid and sibling preparation preserved`);
 }} finally {
  globalThis.fetch=previousFetch;
  const lease=await acquire();try {for(const state of startingStreams)await rpc("sync_upsert_stream",{...leaseArgs(lease),p_state:state});}finally{await release(lease);}
 }
 return checks;
}
