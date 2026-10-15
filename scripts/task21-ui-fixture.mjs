// Synthetic local Data API only. Never forwards requests to Supabase or Matter.
// Run after compiling tests. UI runner overrides all app credentials/URLs.
import http from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require=createRequire(import.meta.url);
const {cappedPostgrest}=require('../.test-build/tests/fixtures/capped-postgrest.js');
export const token='task21-synthetic-session-cookie-only';
let scenario='normal';
const now=new Date(),iso=ms=>new Date(ms).toISOString(),ago=h=>iso(now.getTime()-h*3600000);
const tables=()=>{
  const partial=scenario==='partial',stale=scenario==='stale';
  const streams=['recent_sessions','library_items'].map(stream=>({stream,endpoint:stream==='recent_sessions'?'/reading_sessions':'/items',filters:{},page_limit:25,cursor:partial?'opaque-not-for-ui':null,cycle_started_at:partial?ago(1):null,cycle_active:partial,cycle_generation:3,completed_watermark:ago(72),retry_at:partial?iso(now.getTime()+300000):null,transition_status:'native',coverage_window:'current_year'}));
  return {
    app_sessions:[{token_hash:createHash('sha256').update(token).digest('hex'),expires_at:iso(now.getTime()+3600000),revoked_at:null,credential_version:1}],
    matter_sync_streams:streams,
    matter_sync_continuation:[{account_scope:'matter',history_status:partial?'running':'none',requested_at:partial?ago(2):null}],
    matter_cycle_completions:[{stream:'recent_sessions',cycle_generation:2,source_boundary:ago(72),completed_at:ago(stale?48:2)},{stream:'library_items',cycle_generation:2,source_boundary:ago(72),completed_at:ago(24)}],
    matter_invocation_status:[{id:'synthetic-invocation',trigger:'manual',attempted_at:ago(.1),finished_at:ago(.05),outcome:partial||stale?'partial':'complete'}],
    matter_sync_leases:[{account_scope:'matter',expires_at:partial?iso(now.getTime()+60000):null}],
    sync_runs:[{id:'synthetic-run',started_at:ago(.1),finished_at:ago(.05),status:'success',matter_has_more:partial||stale,items_synced:2,sessions_synced:3,sync_mode:'recent_activity',error_message:null}],
    matter_items:[{id:'synthetic-item',title:'A synthetic reading example',source:'Example journal',author:'Sample author',word_count:1200,status:'queue',progress:.3,updated_at:ago(1)}],
    reading_sessions:[{id:'synthetic-session-a',started_at:ago(1),duration_seconds:600,item_id:null},{id:'synthetic-session-b',started_at:ago(5),duration_seconds:900,item_id:null},{id:'synthetic-session-c',started_at:ago(25),duration_seconds:300,item_id:null}],
    daily_stats:[],annotations:[],item_tags:[],matter_dirty_rollups:partial?[{date:now.toISOString().slice(0,10)}]:[],sync_state:[],
  };
};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/scenario'){
    const next=url.searchParams.get('name');if(!['normal','partial','stale','unavailable'].includes(next)){res.writeHead(400).end();return;}scenario=next;res.end('synthetic');return;
  }
  const fixture=cappedPostgrest(tables(),{respond:({table})=>{
    if(scenario==='unavailable' && ['matter_cycle_completions','matter_items','matter_dirty_rollups','read_matter_generation_status'].includes(table))return Response.json({code:'XX000',message:'Synthetic unavailable query'},{status:500});
    if(table==='read_matter_generation_status')return Response.json({activeId:'synthetic-generation',epoch:'2',frozen:false,rolledBack:false,active:{id:'synthetic-generation',state:'live',timezone:'Europe/Athens',wordMethod:'session-duration-225-round-v1',calendarMethod:'local-occurrence-day-v1',readinessAt:ago(24),reconciled:true,baseline:false,cutover:true},candidate:null});
    if(table==='read_matter_retry_status')return Response.json({nextEligibleAt:scenario==='partial'?iso(now.getTime()+300000):null,manualRecovery:false,pendingRequests:scenario==='partial'?1:0});
  }});
  try{
    const response=await fixture.fetch(`http://synthetic.invalid${req.url}`,{method:req.method,headers:req.headers});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500).end('Synthetic fixture failure');}
});
server.listen(54391,'127.0.0.1',()=>console.log('Synthetic Task 21 Data API listening on 127.0.0.1:54391'));
