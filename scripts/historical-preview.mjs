#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReconciliation, fingerprint, summarize, validateScope } from "./historical-preview-core.mjs";

export function parseArgs(args) {
  const allowed=new Set(["target","start","end","timezone","out"]), result={};
  for(let i=0;i<args.length;i+=2) {
    const k=args[i]?.replace(/^--/,""); if(!args[i]?.startsWith("--")||!allowed.has(k)||result[k]!==undefined||!args[i+1]||args[i+1].startsWith("--")) throw new Error("Usage: --target isolated|production --start YYYY-MM-DD --end YYYY-MM-DD --timezone IANA --out PATH");
    result[k]=args[i+1];
  }
  if(!["isolated","production"].includes(result.target)||!result.out) throw new Error("Explicit target and output required");
  validateScope(result); return result;
}
export function previewSql() {
  const emit=(kind,table,key)=>`COPY (SELECT json_build_object('kind','${kind}','row',to_jsonb(r))::text FROM public.${table} r ORDER BY ${key} COLLATE "C") TO STDOUT;`;
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SET LOCAL row_security = off;
SET LOCAL timezone = 'UTC';
COPY (SELECT json_build_object('kind','snapshot','row',json_build_object('snapshot',pg_current_snapshot()::text,'asOf',transaction_timestamp(),'readOnly',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),'sessionCount',(select count(*) from public.reading_sessions),'dailyCount',(select count(*) from public.daily_stats)) )::text) TO STDOUT;
${emit("daily","daily_stats","date::text")}
${emit("sessions","reading_sessions","id")}
${emit("verifyDaily","daily_stats","date::text")}
${emit("verifySessions","reading_sessions","id")}
COPY (SELECT '{"kind":"end"}'::text) TO STDOUT;
ROLLBACK;
`;
}
export function connectionConfig(target, env) {
  if (!["isolated","production"].includes(target)) throw new Error("Invalid explicit preview target");
  const prefix=target==="production" ? "HISTORICAL_PREVIEW_PRODUCTION" : "HISTORICAL_PREVIEW_ISOLATED";
  if(target==="production" && env.HISTORICAL_PREVIEW_PRODUCTION_READ_ACK!=="yes") throw new Error("Dedicated production read acknowledgement required");
  const service=env[`${prefix}_PGSERVICE`], file=env[`${prefix}_PGSERVICEFILE`];
  if(!service || !/^[A-Za-z0-9_-]+$/.test(service) || !file || !path.isAbsolute(file)) throw new Error(`Require dedicated ${prefix}_PGSERVICE and absolute ${prefix}_PGSERVICEFILE; no application-credential fallback`);
  // No application/Matter credentials, libpq startup injection or inherited connection selection.
  const childEnv=Object.fromEntries(["PATH","SYSTEMROOT","HTTP_PROXY","HTTPS_PROXY","NO_PROXY","SSL_CERT_FILE","SSL_CERT_DIR"].filter(k=>env[k]).map(k=>[k,env[k]]));
  return { command:"psql",args:["-XAtq","-v","ON_ERROR_STOP=1","-d",`service=${service}`,"-f","-"],env:{...childEnv,PGSERVICEFILE:file,PGCONNECT_TIMEOUT:"15"} };
}
export async function readPreview(scope, config, onSnapshot=()=>{}) {
  const reducer=createReconciliation(scope), prints=Object.fromEntries(["daily","sessions","verifyDaily","verifySessions"].map(k=>[k,fingerprint()]));
  const child=spawn(config.command,config.args,{env:config.env,stdio:["pipe","pipe","pipe"]});
  let ended=false,snapshot=null,stage=0,failed=false;
  // Do not echo database error text: it can include credentials or private identifiers.
  child.stderr.resume();
  const exit=new Promise((resolve,reject)=>{ child.once("error",reject);child.once("close",code=>code===0?resolve():reject(new Error(`Read-only source query failed (exit ${code}); report not completed`))); });
  exit.catch(()=>{}); child.stdin.on("error",()=>{});
  const timer=setTimeout(()=>child.kill(),600000);
  child.stdin.end(previewSql());
  try {
    for await(const line of createInterface({input:child.stdout,crlfDelay:Infinity})) {
      if(line.length>2*1024*1024)throw new Error("Source row exceeds bounded transport size");
      // PostgreSQL COPY text escapes backslashes before JSON parsing.
      const event=JSON.parse(line.replace(/\\([\\tnr])/g,(_,c)=>({"\\":"\\",t:"\t",n:"\n",r:"\r"})[c]));
      const index=["snapshot","daily","sessions","verifyDaily","verifySessions","end"].indexOf(event.kind);
      if(index<0||index<stage||ended)throw new Error("Invalid/incomplete snapshot stream"); stage=index;
      if(event.kind==="snapshot") {
        if(snapshot || event.row.readOnly!=="on" || event.row.isolation!=="repeatable read")throw new Error("Source is not a coherent read-only snapshot");
        snapshot=event.row; await onSnapshot(snapshot); continue;
      }
      if(!snapshot)throw new Error("Missing snapshot identity");
      if(event.kind==="end") { ended=true;continue; }
      prints[event.kind].row(event.row);
      if(event.kind==="daily")reducer.daily(event.row);
      if(event.kind==="sessions")reducer.session(event.row);
    }
    await exit;
    if(!ended||!snapshot)throw new Error("Incomplete source stream; report not completed");
    const checks=Object.fromEntries(Object.entries(prints).map(([k,v])=>[k,v.finish()]));
    if(checks.daily.rows!==Number(snapshot.dailyCount)||checks.sessions.rows!==Number(snapshot.sessionCount))throw new Error("Incomplete source row counts");
    if(JSON.stringify(checks.daily)!==JSON.stringify(checks.verifyDaily)||JSON.stringify(checks.sessions)!==JSON.stringify(checks.verifySessions))throw new Error("Inconsistent snapshot/preservation fingerprints");
    return reducer.finish({...snapshot,target:scope.target??"isolated",transport:"PostgreSQL COPY, one connection; all rows; no Data API caps",preservation:{status:"identical_in_read_only_snapshot",before:{daily:checks.daily,sessions:checks.sessions},after:{daily:checks.verifyDaily,sessions:checks.verifySessions}}});
  } catch(e) { failed=true; child.kill();await exit.catch(()=>{});throw e; }
  finally {clearTimeout(timer); if(failed)child.stdout.destroy();}
}
async function main() {
  const args=parseArgs(process.argv.slice(2));
  const report=await readPreview(args,connectionConfig(args.target,process.env));
  // Publish completion only after the transaction ends successfully. Never leave partial JSON as complete.
  const json=`${args.out}.json`,summary=`${args.out}.txt`,tmp=`${json}.${process.pid}.tmp`;
  try { await writeFile(tmp,JSON.stringify(report,null,2)+"\n",{mode:0o600,flag:"wx"}); await rename(tmp,json); await writeFile(summary,summarize(report),{mode:0o600}); } finally {await rm(tmp,{force:true});}
  console.log(summarize(report));
  if(report.completion!=="complete")process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  const safe=/^(Require dedicated|Explicit target|Invalid explicit|Dedicated production|Usage:|Require valid|Range exceeds|Explicit timezone|Invalid timezone|Unsafe aggregate|Unsafe stored|Source row exceeds|Invalid\/incomplete|Source is not|Missing snapshot|Incomplete source|Inconsistent snapshot|Read-only source query failed|Duplicate daily|Too many provenance)/;
  const reason=safe.test(error.message??"") ? error.message : "Source transport, JSON, executable or output failure";
  console.error(`Historical preview FAILED: ${reason}. No completed report from this invocation.`);process.exitCode=1;
});
