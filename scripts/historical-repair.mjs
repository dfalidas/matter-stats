#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionConfig } from './historical-preview.mjs';
import { createReconciliation, fingerprint, validateScope, contract } from './historical-preview-core.mjs';

const uuid = value => { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value ?? '')) throw new Error('Explicit UUID required'); return `'${value}'::uuid`; };
const integer = value => { if (!/^(0|[1-9][0-9]*)$/.test(String(value ?? '')) || BigInt(value) > 9223372036854775807n) throw new Error('Explicit decimal integer required'); return String(value); };
const active = value => value === 'legacy' ? 'null::uuid' : uuid(value);
const quote = value => `'${value.replaceAll("'", "''")}'`;
export function repairConfig(target, env) {
  if (target !== 'isolated' || env.HISTORICAL_REPAIR_ISOLATED_ACK !== 'yes') throw new Error('Only explicitly acknowledged isolated targets are supported');
  return connectionConfig('isolated', {
    PATH: env.PATH, HTTP_PROXY: env.HTTP_PROXY, HTTPS_PROXY: env.HTTPS_PROXY, NO_PROXY: env.NO_PROXY,
    HISTORICAL_PREVIEW_ISOLATED_PGSERVICE: env.HISTORICAL_REPAIR_ISOLATED_PGSERVICE,
    HISTORICAL_PREVIEW_ISOLATED_PGSERVICEFILE: env.HISTORICAL_REPAIR_ISOLATED_PGSERVICEFILE,
  });
}
export async function repairQuery(config, statement) {
  const child = spawn(config.command, config.args, { env: config.env, stdio: ['pipe','pipe','pipe'] });
  let output = ''; child.stderr.resume(); child.stdout.on('data', data => { output += data; if (output.length > 1024 * 1024) child.kill(); });
  child.stdin.on('error', () => {});
  const done = new Promise((resolve,reject) => { child.on('error',reject); child.on('close',code => code === 0 ? resolve(output.trim()) : reject(new Error(`Isolated repair SQL failed (${code}); inspect status before retry`))); });
  const timer = setTimeout(() => child.kill(), 15000);
  child.stdin.end(`BEGIN; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; SET LOCAL idle_in_transaction_session_timeout='10s'; SET LOCAL timezone='UTC'; ${statement}; COMMIT;`);
  try { return JSON.parse(await done); } finally { clearTimeout(timer); }
}
export function repairStatement(command, a) {
  if (command === 'status') return a.run ? `select to_jsonb(g)||jsonb_build_object('fence',fence::text) from public.reading_generations g where id=${uuid(a.run)}` : "select to_jsonb(c)||jsonb_build_object('epoch',epoch::text,'source_revision',source_revision::text) from public.reading_generation_control c where singleton";
  const id = uuid(a.run), owner = uuid(a.owner);
  if (command === 'prepare') {
    if (!a.timezone) throw new Error('Explicit timezone required');
    new Intl.DateTimeFormat('en', { timeZone: a.timezone }).format(0);
    return `select public.repair_prepare(${id},${owner},${active(a.active)},${integer(a.epoch)},${quote(a.timezone)})`;
  }
  const fence = integer(a.fence), args = `${id},${owner},${fence}`;
  if (command === 'claim') return `select public.repair_claim(${args})`;
  if (['execute','resume'].includes(command)) return `select public.repair_batch(${args},${integer(a.rows)},${integer(a.milliseconds)})`;
  if (command === 'reconcile') return `select public.repair_reconcile(${args})`;
  if (command === 'cancel') return `select public.repair_cancel(${args})`;
  if (['cutover','rollback'].includes(command)) return `select public.repair_transition(${args},${active(a.active)},${integer(a.epoch)},${command === 'rollback'})`;
  throw new Error('Unknown repair command');
}
/** Task 19 contract, fed by the durable immutable capture, not a dead snapshot id. */
export async function repairReport(config, a) {
  validateScope(a); const id = uuid(a.run), reducer = createReconciliation(a), prints = {session:fingerprint(),daily:fingerprint()};
  const child = spawn(config.command,config.args,{env:config.env,stdio:['pipe','pipe','pipe']}); child.stderr.resume();child.stdin.on('error',()=>{});
  const done = new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Captured report source query failed')));});done.catch(()=>{});
  let header, ended=false; const captureReasons={};
  const timer=setTimeout(()=>child.kill(),120000);
  child.stdin.end(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='60s'; SET LOCAL timezone='UTC';
    COPY (select jsonb_build_object('kind','header','data',to_jsonb(g))::text from public.reading_generations g where id=${id}) TO STDOUT;
    COPY (select jsonb_build_object('kind',kind,'data',row_data,'invalidReasons',invalid_reasons)::text from public.reading_repair_source where generation=${id} order by kind,key) TO STDOUT;
    COPY (select '{"kind":"end"}'::text) TO STDOUT; COMMIT;`);
  try {
    for await(const line of createInterface({input:child.stdout,crlfDelay:Infinity})) {
      const event=JSON.parse(line.replace(/\\([\\tnr])/g,(_,c)=>({'\\':'\\',t:'\t',n:'\n',r:'\r'})[c]));
      if(event.kind==='header') {if(header || event.data.timezone!==a.timezone || event.data.word_method!==contract.wordMethod || event.data.calendar_method!==contract.calendarMethod)throw new Error('Captured report contract mismatch');header=event.data;continue;}
      if(event.kind==='end'){ended=true;continue;}
      if(!header || !prints[event.kind] || ended) throw new Error('Incomplete captured report');
      if(!Array.isArray(event.invalidReasons))throw new Error('Captured invalid reasons unavailable');
      for(const reason of event.invalidReasons)captureReasons[reason]=(captureReasons[reason]??0)+1;
      prints[event.kind].row(event.data); reducer[event.kind==='session'?'session':'daily'](event.data);
    }
    await done;
    if(!ended || !header || ['capture_sessions','capture_days','cancelled'].includes(header.state)) throw new Error('Capture is incomplete');
    const hashes={session:prints.session.finish(),daily:prints.daily.finish()};
    if(hashes.session.rows!==header.captured_sessions || hashes.daily.rows!==header.captured_days) throw new Error('Incomplete captured source counts');
    const report=reducer.finish({snapshot:header.source_identity,asOf:header.created_at,transport:'Durable immutable capture under a persistent writer barrier',hashes});
    if(header.invalid_rows>0 || header.mismatches>0 || header.state==='blocked')report.completion='complete_read_incomplete_reconciliation';
    return {...report,captureQuality:{invalidRows:header.invalid_rows,invalidReasons:captureReasons,targetMismatches:header.mismatches},run:header,
      limitation:'Daily/monthly old/new/delta describes the immutable capture. Cutover separately requires current-source reconciliation; unknown old semantics remain unavailable.'};
  } finally {clearTimeout(timer);child.kill();await done.catch(()=>{});}
}
async function main() {
  const [command,...args]=process.argv.slice(2), a={};
  const allowed=new Set(['target','run','owner','fence','active','epoch','timezone','rows','milliseconds','start','end','out']);
  for(let i=0;i<args.length;i+=2){const key=args[i]?.replace(/^--/,'');if(!args[i]?.startsWith('--')||!allowed.has(key)||a[key]!==undefined||!args[i+1])throw new Error('Invalid explicit repair arguments');a[key]=args[i+1];}
  const config=repairConfig(a.target,process.env);
  const result=command==='preview' ? await repairReport(config,a) : await repairQuery(config,repairStatement(command,a));
  if(a.out) await writeFile(a.out,JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(result));
  if(command==='preview' && result.completion!=='complete') process.exitCode=2;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(()=>{console.error('Historical repair FAILED. No successful transition claimed; inspect isolated status before retry.');process.exitCode=1;});
