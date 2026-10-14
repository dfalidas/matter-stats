import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReconciliation, contract, summarize, validateScope } from "../scripts/historical-preview-core.mjs";
import { parseArgs, connectionConfig, readPreview, previewSql } from "../scripts/historical-preview.mjs";

const scope={start:"2025-01-01",end:"2027-01-02",timezone:"Europe/Athens"};
const session=(id,started_at,duration_seconds,words_estimated=999,word_estimation_method=null)=>({id,started_at,duration_seconds,words_estimated,word_estimation_method,item_id:null});
const daily=(date,words_read,reading_time_seconds=0,sessions_count=0,timezone=null)=>({date,words_read,reading_time_seconds,sessions_count,reading_provenance:timezone?{calendarMethod:contract.calendarMethod,wordMethod:contract.wordMethod,timezone}:null,highlights_count:987,items_read_count:42,top_source:"synthetic.example"});
export const fixture={daily:[daily("2025-12-31",1000,60,1,"UTC"),daily("2026-01-01",3000,180,3),daily("2026-01-02",10,3,3,"Europe/Athens"),daily("2026-01-04",225,60,1,"UTC")],sessions:[
  session("midnight","2025-12-31T22:00:00Z",60,225),
  ...["a","b","c"].map(id=>session(id,"2026-01-01T10:00:00Z",60,id==="a"?225:1000,id==="a"?contract.wordMethod:id==="b"?"legacy-item-progress-v0":null)),
  ...["d","e","f"].map(id=>session(id,"2026-01-02T10:00:00Z",1,3)),
  session("zero","2026-01-03T10:00:00Z",0,0,contract.wordMethod),
  session("monday","2026-01-04T22:00:00Z",60,225),
  session("spring-before","2026-03-29T00:59:59Z",60,225),session("spring-after","2026-03-29T01:00:00Z",60,225),
  session("fall-before","2026-10-25T00:59:59Z",60,225),session("fall-after","2026-10-25T01:00:00Z",60,225),
  session("month","2026-01-31T22:00:00Z",1,4),session("year","2026-12-31T22:00:00Z",1,4),
  session("invalid-duration","2026-01-06T10:00:00Z",null),session("invalid-timestamp",null,60),session("negative","2026-01-06T10:00:00Z",-1),session("bad-date","2026-02-30T10:00:00Z",60)
]};
function run(data=fixture,s=scope) { const r=createReconciliation(s);data.daily.forEach(r.daily);data.sessions.forEach(r.session);return r.finish({snapshot:"synthetic-fixture-v1",asOf:"2026-10-14T00:00:00Z"}); }
test("independent daily/monthly references, no method inferred from equality, stale/missing union",()=>{
  const r=run(),d=date=>r.daily.find(d=>d.date===date);
  assert.equal(d("2026-01-01").proposed.words_read,900); // 3 × 225 + prior UTC date's 225
  assert.equal(d("2026-01-02").proposed.words_read,12);
  assert.equal(d("2026-01-03").proposed.sessions_count,1);
  assert.equal(d("2026-01-03").proposed.words_read,0);
  assert.equal(d("2025-12-31").staleDateWouldBecomeEmpty,true);
  assert.equal(d("2026-01-05").missingRollup,true);
  assert.equal(d("2026-01-01").oldProvenance,null);
  assert.equal(d("2026-01-01").explanation.timezoneReassignment,null);
  const old=d("2025-12-31");assert.equal(old.explanation.timezoneReassignment.words_read,-225);assert.equal(old.explanation.unexplainedResidual.words_read,-775);
  assert.deepEqual(d("2026-01-02").explanation.wordMethodDifference,{reading_time_seconds:0,words_read:3,sessions_count:0});
  assert.equal(r.monthly.find(m=>m.month==="2026-01").proposed.words_read,1137);
  assert.equal(r.invalid.sessionRows,4);assert.equal(r.invalid.sessions.invalid_duration,2);assert.equal(r.invalid.sessions.invalid_timestamp,2);
  assert.equal(r.completion,"complete_read_incomplete_reconciliation");assert.equal(r.provenance.legacyUnknown>0,true);
  assert.ok(r.excludedFields.includes("highlights_count"));assert.deepEqual(run(),r); assert.match(summarize(r),/missing/);
});
test("three 60 seconds exactly 675; three 1 seconds exactly 12; both DST and calendar boundaries",()=>{
  assert.equal(run({daily:[],sessions:[1,2,3].map(i=>session(String(i),"2026-01-01T10:00:00Z",60))}).daily[0].proposed.words_read,675);
  const r=run(); for(const date of ["2026-03-29","2026-10-25"])assert.equal(r.daily.find(d=>d.date===date).proposed.words_read,450);
  for(const date of ["2026-02-01","2027-01-01"])assert.equal(r.daily.find(d=>d.date===date).proposed.words_read,4);
  assert.ok(r.daily.some(d=>d.date==="2026-01-05"));
  const long=run({daily:[],sessions:[session("whole-duration","2026-01-01T21:30:00Z",7200)]});
  assert.equal(long.daily.length,1);assert.equal(long.daily[0].date,"2026-01-01");assert.equal(long.daily[0].proposed.words_read,27000);
});
test("invalid stored word baseline stays unavailable; invalid daily is separately reported",()=>{
  const r=run({daily:[daily("2026-01-01",null)],sessions:[session("valid","2026-01-01T00:00:00Z",60,null)]});
  assert.equal(r.daily[0].storedSessionWords,null);assert.equal(r.daily[0].sessionWordDelta,null);assert.equal(r.monthly[0].storedSessionWords,null);assert.equal(r.invalid.dailyRows,1);
  const invalidZone=run({daily:[daily("2026-01-01",225,60,1,"invalid-zone")],sessions:[]});
  assert.equal(invalidZone.invalid.daily.invalid_provenance_timezone,1);assert.equal(invalidZone.daily[0].explanation.status,"unavailable");
});
test("validation rejects invalid dates, oversized scope, duplicate/invalid daily and timezone inputs",()=>{
  for(const s of [{...scope,start:"2026-02-30"},{...scope,end:"2040-01-01"},{...scope,timezone:"nonsense"}])assert.throws(()=>validateScope(s));
  assert.throws(()=>parseArgs(["--target","production"]));assert.throws(()=>connectionConfig("isolated",{SUPABASE_URL:"https://production.example"}));
  assert.throws(()=>connectionConfig("production",{HISTORICAL_PREVIEW_ISOLATED_PGSERVICE:"local",HISTORICAL_PREVIEW_ISOLATED_PGSERVICEFILE:"/tmp/local"}));
  const c=connectionConfig("isolated",{HISTORICAL_PREVIEW_ISOLATED_PGSERVICE:"local",HISTORICAL_PREVIEW_ISOLATED_PGSERVICEFILE:"/tmp/local",MATTER_API_TOKEN:"never-forward",PGOPTIONS:"-c injected",PGHOST:"production"});
  assert.equal(c.env.MATTER_API_TOKEN,undefined);assert.equal(c.env.PGOPTIONS,undefined);assert.equal(c.env.PGHOST,undefined);
});
function stream(data,snapshot={snapshot:"123:123:",asOf:"2026-10-14T00:00:00Z",readOnly:"on",isolation:"repeatable read",sessionCount:data.sessions.length,dailyCount:data.daily.length}) {
  return [{kind:"snapshot",row:snapshot},...["daily","sessions","verifyDaily","verifySessions"].flatMap(kind=>data[kind.replace("verify","").toLowerCase()].map(row=>({kind,row}))),{kind:"end"}].map(e=>JSON.stringify(e).replaceAll("\\","\\\\")+"\n").join("");
}
async function withSource(source,fn,code=0) {
  const dir=await mkdtemp(path.join(os.tmpdir(),"preview-unit-"));
  try { const file=path.join(dir,"source.mjs");await writeFile(file,`process.stdin.resume();process.stdout.write(${JSON.stringify(source)});process.exitCode=${code};`);return await fn({command:process.execPath,args:[file],env:{PATH:process.env.PATH}}); }
  finally {await rm(dir,{recursive:true,force:true});}
}
test("stream handles >10k tied timestamps, fingerprint preservation and repeated results",async()=>{
  const data={daily:[],sessions:Array.from({length:10003},(_,i)=>session(`tie-${String(i).padStart(6,"0")}`,"2026-01-01T10:00:00Z",1,4))};
  await withSource(stream(data),async config=>{const r=await readPreview(scope,config),again=await readPreview(scope,config);assert.equal(r.daily[0].proposed.words_read,40012);assert.equal(r.daily[0].proposed.sessions_count,10003);assert.deepEqual(r,again);assert.deepEqual(r.source.preservation.before,r.source.preservation.after);});
});
test("source failures, incomplete counts, missing end, mixed snapshot and changed fingerprints fail visibly",async()=>{
  for(const source of [stream(fixture).replace(/.*"kind":"end".*\n/,""),stream(fixture).replace('"sessionCount":19','"sessionCount":999'),stream(fixture).replace('"readOnly":"on"','"readOnly":"off"'),stream(fixture).replace('"kind":"verifySessions","row":{"id":"midnight"','"kind":"verifySessions","row":{"id":"changed"')]) {
    // Explicit count case uses an independently incorrect header, without relying on fixture length.
    if(source===stream(fixture))continue;
    await withSource(source,async config=>assert.rejects(readPreview(scope,config)));
  }
  await withSource(stream(fixture,{snapshot:"s",readOnly:"on",isolation:"repeatable read",sessionCount:999,dailyCount:4}),async config=>assert.rejects(readPreview(scope,config),/counts/));
  await withSource(stream(fixture),async config=>assert.rejects(readPreview(scope,config),/failed/),1);
  assert.match(previewSql(),/REPEATABLE READ READ ONLY/);assert.match(previewSql(),/ROLLBACK/);assert.doesNotMatch(previewSql(),/INSERT|UPDATE|DELETE|lease|checkpoint|dirty|Matter/i);
});
test("fixture evidence is synthetic and deterministic",async()=>{
  const evidence=JSON.parse(await readFile(new URL("../docs/evidence/task19-synthetic.json",import.meta.url),"utf8"));assert.deepEqual(evidence,run());
});
