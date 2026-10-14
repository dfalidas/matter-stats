import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { sanitizedEnvironment } from "../../scripts/stabilization-db-orchestrator.mjs";
import { assertSuccessful } from "./supabase-security-assertions.mjs";
import { createReconciliation } from "../../scripts/historical-preview-core.mjs";

assert.equal(process.env.DISPOSABLE_DB_ACK,"yes");
const project=process.env.STABILIZATION_TEST_SQL_PROJECT;
assert.match(project??"",/^matter-stats-(fresh|upgrade)-[a-z0-9-]+$/);
const url=process.env.STABILIZATION_TEST_SUPABASE_URL;
assert.ok(["127.0.0.1","localhost"].includes(new URL(url).hostname));
assert.ok(process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY);
const service=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const sql=statement=>new Promise((resolve,reject)=>{
  const child=spawn("docker",["--host=unix:///var/run/docker.sock","exec","-i",`supabase_db_${project}`,"psql","-XAtq","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-f","-"],{env:sanitizedEnvironment(),stdio:["pipe","pipe","pipe"]});
  let output="";child.stdout.on("data",chunk=>{output+=chunk;});child.stderr.resume();child.on("error",reject);child.on("close",code=>code===0?resolve(output.trim()):reject(new Error(`Isolated word-method SQL failed (${code})`)));child.stdin.end(statement);
});
const rpc=async(name,args)=>{const result=await service.rpc(name,args);assertSuccessful(result,name);return result.data;};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const {normalizeReadingSession}=createRequire(import.meta.url)(path.join(root,".test-build/lib/matter-normalizers.js"));
const prefix=`word-method-${crypto.randomUUID()}`,owner=crypto.randomUUID();
const date="2350-02-02",timestamp=`${date}T10:00:00Z`;
const expectedCases=new Map([[2,8],[6,23],[130,487],[246,922],[262,982]]);
const rows=Array.from({length:601},(_,seconds)=>normalizeReadingSession({id:`${prefix}-${String(seconds).padStart(3,"0")}`,date:timestamp,seconds_read:seconds}));
assert.ok(rows.every(Boolean));
const expectedWords=rows.map((r,seconds)=>{assert.equal(r.duration_seconds,seconds);assert.equal(r.words_estimated,Math.round(seconds / 60 * 225));assert.equal(r.word_estimation_method,"session-duration-225-round-v1");return r.words_estimated;});
for(const [seconds,words] of expectedCases)assert.equal(expectedWords[seconds],words);
const preview=createReconciliation({start:date,end:"2350-02-03",timezone:"Europe/Athens"});rows.forEach(preview.session);
assert.equal(preview.finish({snapshot:"synthetic-reference"}).daily[0].proposed.words_read,expectedWords.reduce((a,b)=>a+b,0));
const sqlBoundary=JSON.parse(await sql(`select json_agg(json_build_object('seconds',s,'oldNumeric',floor(s::numeric /60*225+0.5),'binaryValue',((s::double precision /60::double precision)*225::double precision)::text))::text from unnest(array[2,6,130,246,262]) s;`));
assert.deepEqual(sqlBoundary.map(r=>r.oldNumeric),[7,23,488,923,983]);
for(const r of sqlBoundary)assert.equal(Number(r.binaryValue),r.seconds /60*225,"Actual PostgreSQL float division/multiply must match the JS intermediate");

let lease,originalStream,receipt=null,report,owned=false;
const fields=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!["created_at","updated_at"].includes(k)));
const readStream=async()=>{const result=await service.from("matter_sync_streams").select("*").eq("stream","recent_sessions").single();assertSuccessful(result,"reading stream");return result.data;};
const stateSnapshot=()=>sql(`select jsonb_build_object('stream',(select to_jsonb(s) from public.matter_sync_streams s where stream='recent_sessions'),'receipts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.matter_page_receipts r),'dirty',(select coalesce(jsonb_agg(to_jsonb(d) order by date),'[]') from public.matter_dirty_rollups d),'sessions',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.reading_sessions r where id like '${prefix}-%'))::text;`);
try {
  assert.equal(await sql(`select count(*) from public.reading_sessions where id like '${prefix}-%';`),"0");
  assert.equal(await sql(`select count(*) from public.reading_sessions where (started_at at time zone 'Europe/Athens')::date='${date}';`),"0");
  assert.equal(await sql(`select count(*) from public.daily_stats where date='${date}';`),"0");
  assert.equal(await sql("select count(*) from public.matter_page_receipts;"),"0");
  assert.equal(await sql("select count(*) from public.matter_dirty_rollups;"),"0");
  originalStream=await readStream();
  const acquired=await rpc("acquire_matter_sync_lease",{p_account_scope:"matter",p_owner:owner,p_ttl_seconds:120});assert.equal(acquired.length,1);
  lease={p_account_scope:"matter",p_owner:owner,p_generation:acquired[0].generation};
  owned=true;
  await rpc("sync_upsert_stream",{...lease,p_state:{...originalStream,cursor:null,cycle_active:true,cycle_started_at:"2350-03-01T00:00:00Z",cycle_generation:originalStream.cycle_generation+1,page_limit:100,filters:{},retry_at:null,coverage_window:"all"}});
  let committedPages=0;
  const envelope=async(sessions,nextReceipt)=>({...lease,p_receipt_id:nextReceipt,p_previous_receipt_id:receipt,p_expected:fields(await readStream()),p_plan:{placeholders:[],items:[],sessions,tags:[],annotations:[],itemTags:[],itemTagIds:[]},p_has_more:true,p_next_cursor:`word:${nextReceipt}`,p_timezone:"Europe/Athens"});
  for(let offset=0;offset<rows.length;offset+=100) {
    const next=crypto.randomUUID();await rpc("commit_matter_page",await envelope(rows.slice(offset,offset+100),next));receipt=next;committedPages++;
  }
  assert.equal(committedPages,7);
  const stored=JSON.parse(await sql(`select json_agg(json_build_object('seconds',duration_seconds,'words',words_estimated,'method',word_estimation_method) order by duration_seconds)::text from public.reading_sessions where id like '${prefix}-%';`));
  assert.equal(stored.length,601);
  stored.forEach((r,seconds)=>{assert.equal(r.seconds,seconds);assert.equal(r.words,expectedWords[seconds]);assert.equal(r.method,"session-duration-225-round-v1");});
  // Corrupting any exact/near-half boundary must fail the real page transaction.
  // A successful row is ordered before the bad update to prove transaction rollback.
  let rejectedPages=0;
  for(const [seconds] of expectedCases)for(const delta of [-1,1]) {
    const before=await stateSnapshot();
    const valid={...rows[0],id:`${prefix}-rollback-${seconds}-${delta}`};
    const bad={...rows[seconds],words_estimated:expectedWords[seconds]+delta};
    const response=await service.rpc("commit_matter_page",await envelope([valid,bad],crypto.randomUUID()));
    assert.equal(response.status,400);assert.equal(response.error?.code,"23514");
    assert.match(response.error?.message??"",/check constraint "session_word_method_valid"/);
    assert.equal(await stateSnapshot(),before,"Bad canonical tag must roll back rows, checkpoint, receipt and dirty revision");rejectedPages++;
  }
  assert.equal(rejectedPages,10);
  report={status:"passed",checks:["SQL binary64 intermediates and normalizer/preview agree at 2,6,130,246,262 seconds","All 601 normalizer outputs (0–600 seconds) persisted through 7 real fenced Data API page transactions","Ten incorrectly tagged boundary updates fail HTTP 400 / 23514 / session_word_method_valid and atomically preserve rows, checkpoint, receipt and dirty revision"],range:{start:0,endInclusive:600,rows:stored.length,committedPages,rejectedPages},boundaries:[...expectedCases].map(([seconds,words])=>({seconds,words})),realSqlAndDataApi:true,syntheticOnly:true};
} finally {
  if(owned) {
    // The fixed stream/receipt/date scope was checked empty before this fixture claimed it.
    if(receipt) assert.equal(await sql(`delete from public.matter_page_receipts where stream='recent_sessions' and receipt_id='${receipt}' returning receipt_id;`),receipt,"Receipt ownership changed; refuse unrelated cleanup");
    else assert.equal(await sql("select count(*) from public.matter_page_receipts where stream='recent_sessions';"),"0");
    await sql(`delete from public.matter_dirty_rollups where date='${date}'; delete from public.reading_sessions where id like '${prefix}-%';`);
    await rpc("sync_upsert_stream",{...lease,p_state:originalStream});
    assert.equal(await rpc("release_matter_sync_lease",lease),true);
  }
}

console.log(JSON.stringify({...report,cleanup:"passed"}));
