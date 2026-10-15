import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.join(repo,'.test-build');
const require=Module.createRequire(import.meta.url),originalLoad=Module._load,originalResolve=Module._resolveFilename;
const {cappedPostgrest}=require(path.join(root,'tests/fixtures/capped-postgrest.js'));
let client;
Module._resolveFilename=function(request,parent,...rest){if(request==='server-only')return path.join(repo,'tests/fixtures/server-only.cjs');if(request.startsWith('@/'))request=path.join(root,request.slice(2))+'.js';return originalResolve.call(this,request,parent,...rest);};
Module._load=function(request,parent,...rest){
  if(request==='@/lib/supabase-admin')return {getSupabaseAdminClient:()=>client};
  if(request==='@/lib/require-auth')return {requireAccessSession:async()=>{}};
  if(request==='@/lib/access-control')return {authorizeAccessSession:async()=>true};
  if(request==='@/lib/auth-actions')return {logout:async()=>{}};
  if(request==='@/lib/matter-sync')return {syncMatterData:async()=>({ok:true,status:'partial',syncRunId:'private-lease-owner',message:'Invocation finished; work remains.'})};
  if(request==='next/cache')return {revalidatePath:()=>{}};
  if(request==='next/headers')return {cookies:async()=>({get:()=>({value:'synthetic-session'})})};
  if(request.endsWith('/sync-matter-button'))return {SyncMatterButton:()=>null};
  return originalLoad.call(this,request,parent,...rest);
};
const dashboard=require(path.join(root,'app/dashboard/page.js')).default;
const settings=require(path.join(root,'app/settings/page.js')).default;
const {syncMatterAction}=require(path.join(root,'app/dashboard/actions.js'));
Module._load=originalLoad;Module._resolveFilename=originalResolve;
function find(node,name){if(!node)return;if(Array.isArray(node)){for(const child of node){const match=find(child,name);if(match)return match;}}else if(typeof node==='object'){if(node.type?.name===name)return node.props;return find(node.props?.children,name);}}
test('Overview, Settings and actual authorized manual feedback share one durable interpretation',async t=>{
  const now=new Date('2026-10-15T12:00:00Z');t.mock.timers.enable({apis:['Date'],now});
  const old=process.env.APP_TIMEZONE;process.env.APP_TIMEZONE='Europe/Athens';
  try{
    for(const unavailable of [false,true]){
      const fixture=cappedPostgrest({
        matter_sync_streams:[{stream:'recent_sessions',cycle_active:true,coverage_window:'current_year'},{stream:'library_items',cycle_active:false}],
        matter_cycle_completions:[{stream:'recent_sessions',cycle_generation:1,source_boundary:'2026-10-12T00:00:00Z',completed_at:'2026-10-13T12:00:00Z'}],
        matter_invocation_status:[{id:'attempt',trigger:'manual',attempted_at:'2026-10-15T11:59:00Z',outcome:'partial',finished_at:'2026-10-15T11:59:30Z'}],
        reading_sessions:[{id:'session',started_at:'2026-10-15T10:00:00Z',duration_seconds:60,item_id:null}],
        matter_sync_leases:[{account_scope:'matter',expires_at:null}],matter_sync_continuation:[{account_scope:'matter',history_status:'pending',requested_at:'2026-10-15T10:00:00Z'}],
      },{respond:({table})=>{
        if(unavailable && table==='matter_cycle_completions')return Response.json({message:'private-database-error'},{status:500});
        if(table==='read_matter_generation_status')return Response.json({activeId:null,epoch:'0',frozen:false,rolledBack:false,active:null,candidate:null});
        if(table==='read_matter_retry_status')return Response.json({nextEligibleAt:null,manualRecovery:false,pendingRequests:0});
      }});client=fixture.client;
      const a=find(await dashboard({}), 'SyncStatusPanel').view,b=find(await settings(),'SyncStatusPanel').view;
      assert.deepEqual(a,b);assert.match(a.summary,unavailable?/Sessions status unavailable/:/Sessions completion is stale/);
      const feedback=await syncMatterAction(null,new FormData());assert.ok(feedback.message.includes(a.summary));assert.ok(!feedback.syncRunId);assert.doesNotMatch(feedback.message,/private-database-error|private-lease-owner/);
      const totals=find(await dashboard({}),'DashboardOverview').metricsResult.metrics.totals;assert.equal(totals.wordsRead,225);
    }
  }finally{t.mock.timers.reset();if(old===undefined)delete process.env.APP_TIMEZONE;else process.env.APP_TIMEZONE=old;}
});
