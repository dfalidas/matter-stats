import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveSyncStatus, loadSyncStatus, known, absent, unavailable, staleHours, statusTimestamp, type StatusInputs, type GenerationEvidence } from '../lib/sync-status';
import { cappedPostgrest } from './fixtures/capped-postgrest';
import { loadSettingsStatus } from '../lib/settings-status-service';
import { loadOverviewLibrary, getOverviewReadingMetrics } from '../lib/overview-service';

const now = new Date('2026-10-15T12:00:00Z');
const completed = '2026-10-14T00:00:00Z';
const gen: GenerationEvidence = {activeId:null,epoch:'0',frozen:false,rolledBack:false,active:null,candidate:null};
function inputs(): StatusInputs {
  return {streams:known(['recent_sessions','library_items'].map(stream=>({stream,cycle_active:false,cycle_started_at:null,completed_watermark:'2026-10-12T00:00:00Z',retry_at:null,coverage_window:null,transition_status:'native'}))),
    completions:known([{stream:'recent_sessions',cycle_generation:1,source_boundary:'2026-10-12T00:00:00Z',completed_at:completed}]),
    attempts:known([{id:'new',trigger:'manual',attempted_at:'2026-10-15T11:59:00Z',finished_at:'2026-10-15T11:59:30Z',outcome:'partial'}]),
    runs:known([{id:'new',started_at:'2026-10-15T11:59:00Z',finished_at:'2026-10-15T11:59:30Z',status:'success',matter_has_more:true}]),
    newestSession:known('2026-10-15T11:55:00Z'),continuation:known({history_status:'none',requested_at:null}),lease:known({occupied:false,expiresAt:null}),retry:known({nextEligibleAt:null,manualRecovery:false,pendingRequests:0}),legacyCooldown:absent,dirtyRollups:known(0),generation:known(structuredClone(gen))};
}
const derive = (input:StatusInputs, clock=now, hours=36)=>deriveSyncStatus(input,clock,'Europe/Athens',hours);
test('recent successful partial invocation and imported occurrence do not clear stale sessions',()=>{
  const s=derive(inputs());assert.equal(s.freshness,'stale');assert.equal(s.lastAttempt.state,'known');
  assert.match(s.view.summary,/stale/);assert.equal(s.metadata.state,'unknown');assert.equal(s.coverage,'unverified');
});
test('sessions and metadata complete independently; zero-session completion refreshes freshness',()=>{
  const i=inputs();i.completions=known([{stream:'recent_sessions',cycle_generation:2,source_boundary:'2026-10-13T00:00:00Z',completed_at:'2026-10-15T11:00:00Z'}]);
  i.newestSession=absent;const s=derive(i);assert.equal(s.freshness,'fresh');assert.equal(s.metadata.state,'unknown');
  i.completions=known([{stream:'library_items',cycle_generation:1,source_boundary:'2026-10-13T00:00:00Z',completed_at:'2026-10-15T11:00:00Z'}]);
  assert.equal(derive(i).sessions.state,'unknown');assert.equal(derive(i).metadata.state,'known');
});
test('failed, skipped, rate-limited and budget-limited invocation outcomes preserve last proven completion',()=>{
  for(const outcome of ['error','skipped_locked','skipped_rate_limited','partial','attempted','complete']){
    const i=inputs();i.attempts=known([{id:'attempt',trigger:'scheduled',attempted_at:now.toISOString(),finished_at:null,outcome}]);
    assert.deepEqual(derive(i).sessions,{state:'known',at:completed,sourceBoundary:'2026-10-12T00:00:00Z'});assert.equal(derive(i).freshness,'stale');
  }
});
test('staleness is >= exact elapsed threshold, configurable, with explicit timezone display',()=>{
  assert.equal(derive(inputs(),new Date(now.getTime()-1)).freshness,'fresh');assert.equal(derive(inputs()).freshness,'stale');
  assert.equal(derive(inputs(),new Date(now.getTime()+1)).freshness,'stale');assert.equal(derive(inputs(),now,48).freshness,'fresh');
  assert.equal(staleHours({MATTER_SYNC_STALE_HOURS:'12.5'}),12.5);for(const v of ['','0','-1','NaN','Infinity'])assert.equal(staleHours({MATTER_SYNC_STALE_HOURS:v}),36);
  assert.equal(statusTimestamp('2026-10-15T22:30:00Z','Europe/Athens'),'16 Oct 2026, 01:30 (Europe/Athens)');
});
test('missing history, never completed, legacy timestamps and unavailable reads are distinct',()=>{
  const i=inputs();i.attempts=known([]);i.runs=known([]);i.completions=known([]);i.newestSession=absent;
  assert.equal(derive(i).sessions.state,'unknown');i.streams=known([{stream:'recent_sessions',cycle_active:false,cycle_started_at:null,completed_watermark:null,retry_at:null,coverage_window:null,transition_status:'native'}]);
  assert.equal(derive(i).sessions.state,'never');assert.match(derive(i).view.summary,/No completed/);
  i.completions=unavailable;assert.equal(derive(i).freshness,'unavailable');assert.equal(derive(i).lastAttempt.state,'absent');
});
test('unknown legacy trigger and old running log never imply active worker',()=>{
  const i=inputs();i.attempts=known([]);i.runs=known([{id:'legacy-private-run',started_at:completed,finished_at:null,status:'running',matter_has_more:null}]);
  const s=derive(i);assert.equal(s.lease.state,'known');assert.ok(s.lastAttempt.state==='known');assert.equal(s.lastAttempt.value.trigger,'unknown');assert.match(s.lastAttempt.value.outcome,/unknown/);
});
test('lease expiry boundary and pending retry/manual recovery are explicit',()=>{
  const i=inputs();i.lease=known({occupied:true,expiresAt:now.toISOString()});let s=derive(i);assert.ok(s.lease.state==='known');assert.equal(s.lease.value.state,'expired');
  i.lease=known({occupied:true,expiresAt:new Date(now.getTime()+1).toISOString()});s=derive(i);assert.ok(s.lease.state==='known');assert.equal(s.lease.value.state,'active');
  i.retry=known({nextEligibleAt:'2026-10-15T12:05:00Z',manualRecovery:true,pendingRequests:2});s=derive(i);assert.ok(s.retry.state==='known');assert.equal(s.retry.value.nextEligibleAt,'2026-10-15T12:05:00Z');assert.equal(s.retry.value.manualRecovery,true);
});
function canonical(): GenerationEvidence {return {...gen,activeId:'active',epoch:'2',active:{id:'active',state:'live',timezone:'Europe/Athens',wordMethod:'session-duration-225-round-v1',calendarMethod:'local-occurrence-day-v1',readinessAt:'2026-10-14T14:00:00Z',reconciled:true,baseline:false,cutover:true}};}
test('dirty backlog, acknowledgement and readiness transitions without repair execution',()=>{
  const i=inputs();i.generation=known(canonical());assert.equal(derive(i).derived,'ready');i.dirtyRollups=known(2);assert.equal(derive(i).derived,'pending dirty rollups');i.dirtyRollups=known(0);assert.equal(derive(i).derived,'ready');i.dirtyRollups=unavailable;assert.equal(derive(i).derived,'unavailable');
});
test('legacy, building, blocked, frozen, ready candidate, active cutover and rollback remain separate',()=>{
  const i=inputs();assert.equal(derive(i).derived,'legacy / unverified');
  for(const state of ['capture_sessions','capture_days','catchup','verify_sessions','verify_days','blocked','ready']){
    const g=canonical();g.candidate={state,timezone:'Europe/Athens',readinessAt:completed,reconciled:state==='ready',pendingChanges:state!=='ready'};i.generation=known(g);
    assert.match(derive(i).derived,/not applied/);assert.match(derive(i).view.details.find(d=>d.label==='Active derived generation')!.value,/active · epoch 2/);
    g.frozen=true;assert.equal(derive(i).derived,'writer barrier frozen');
  }
  const g=canonical();g.rolledBack=true;i.generation=known(g);assert.match(derive(i).view.details.find(d=>d.label==='Active derived generation')!.value,/rollback applied/);
  g.active!.timezone='UTC';assert.equal(derive(i).derived,'timezone mismatch');
  assert.equal(derive(i).coverage,'unverified');assert.match(derive(i).view.details.find(d=>d.label==='Session-to-item attribution')!.value,/Unsupported.*not guaranteed/);
});
function httpFixture(fail?:string, missingCount=false, generation:unknown=gen) {
  const tables={matter_sync_streams:[],matter_cycle_completions:[{stream:'recent_sessions',cycle_generation:1,source_boundary:'2026-10-12T00:00:00Z',completed_at:completed}],matter_invocation_status:[],sync_runs:[],matter_sync_continuation:[{account_scope:'matter',history_status:'none',requested_at:null}],matter_sync_leases:[{account_scope:'matter',expires_at:null}],reading_sessions:[{id:'session',item_id:null,started_at:'2026-10-15T08:00:00Z',duration_seconds:60}],matter_items:[{id:'item',title:'Synthetic'}],daily_stats:[],matter_dirty_rollups:[]};
  return cappedPostgrest(tables,{respond:({table,url})=>{
    if(table===fail)return Response.json({message:'SENSITIVE_DATABASE_PAYLOAD',code:'XX000'},{status:500});
    if(missingCount && table==='matter_items')return new Response(null,{status:200});
    if(table==='read_matter_generation_status')return Response.json(generation);
    if(table==='read_matter_retry_status')return Response.json({nextEligibleAt:null,manualRecovery:false,pendingRequests:0});
    if(table==='reading_generation_control')return Response.json({active:null});
    void url;
  }});
}
test('new persisted candidate with SQL NULL reconciliation retains frozen/unapplied status without claiming readiness',async()=>{
  const candidate={state:'capture_sessions',timezone:'Europe/Athens',readinessAt:null,reconciled:null,pendingChanges:false};
  const {client}=httpFixture(undefined,false,{...gen,frozen:true,candidate});
  const s=await loadSyncStatus(client,now,'Europe/Athens');
  assert.equal(s.derived,'writer barrier frozen');
  assert.match(s.view.details.find(d=>d.label==='Historical repair')!.value,/reconciliation unresolved; not applied/);
  assert.equal(s.hasUnavailableSections,false);
});
test('malformed candidate reconciliation still fails closed while explicit false and true retain their meanings',async()=>{
  for(const reconciled of [false,true,'true',undefined]){
    const candidate={state:'ready',timezone:'Europe/Athens',readinessAt:completed,reconciled,pendingChanges:false};
    const {client}=httpFixture(undefined,false,{...gen,candidate});
    const s=await loadSyncStatus(client,now,'Europe/Athens');
    assert.equal(s.derived,typeof reconciled==='boolean'?'historical repair ready; not applied':'unavailable');
    if(typeof reconciled==='boolean')assert.match(s.view.details.find(d=>d.label==='Historical repair')!.value,reconciled?/reconciled candidate; not applied/:/reconciliation unresolved; not applied/);
  }
});
test('bounded local status reads check every independent query failure without false healthy fallbacks',async()=>{
  for(const fail of ['matter_sync_streams','matter_cycle_completions','matter_invocation_status','sync_runs','reading_sessions','matter_sync_continuation','matter_sync_leases','read_matter_retry_status','sync_state','matter_dirty_rollups','read_matter_generation_status']){
    const {client,requests}=httpFixture(fail);const s=await loadSyncStatus(client,now,'Europe/Athens');assert.doesNotMatch(JSON.stringify(s),/SENSITIVE/);
    if(fail==='matter_cycle_completions')assert.equal(s.sessions.state,'unavailable');
    else assert.equal(s.sessions.state,'known');
    const section:Record<string,unknown>={matter_sync_streams:s.activeStreams,matter_invocation_status:s.lastAttempt,sync_runs:s.lastAttempt,reading_sessions:s.view.details.find(d=>d.label==='Newest imported session occurrence')!.value,matter_sync_continuation:s.view.details.find(d=>d.label==='Session history intent')!.value,matter_sync_leases:s.lease,read_matter_retry_status:s.retry,sync_state:s.retry,matter_dirty_rollups:s.derived,read_matter_generation_status:s.derived};
    if(fail!=='matter_cycle_completions')assert.match(JSON.stringify(section[fail]),/unavailable/i);
    assert.equal(requests.length,11);assert.ok(requests.every(r=>r.rowCount<=3));assert.ok(requests.every(r=>!r.url.searchParams.get('select')?.includes('owner')));
  }
});
test('count failures and missing counts preserve independent Settings counts and stream status',async()=>{
  for(const [fail,missing] of [['matter_items',false],[undefined,true]] as const){
    const {client}=httpFixture(fail,missing);const s=await loadSettingsStatus(client,now,'Europe/Athens');assert.equal(s.counts[2].result.state,'unavailable');assert.deepEqual(s.counts[0].result,known(1));assert.equal(s.status.sessions.state,'known');
  }
});
test('Overview library failure is unavailable; an empty successful read is empty',async()=>{
  const failed=httpFixture('matter_items');assert.equal((await loadOverviewLibrary(failed.client)).state,'unavailable');
  const empty=cappedPostgrest({matter_items:[]});assert.deepEqual(await loadOverviewLibrary(empty.client),known([]));
});
test('status queries do not change canonical metric totals',async()=>{
  const {client}=httpFixture();const first=await getOverviewReadingMetrics(client,'all-time',null,null,now,'Europe/Athens');
  await loadSyncStatus(client,now,'Europe/Athens');const after=await getOverviewReadingMetrics(client,'all-time',null,null,now,'Europe/Athens');
  assert.equal(first.metrics.totals.wordsRead,225);assert.equal(first.metrics.totals.totalReadingTimeSeconds,60);assert.deepEqual(after,first);
});

test('an absent stream is explicit and cannot certify idle ingestion',()=>{
  const i=inputs();i.streams=known([]);const s=derive(i);
  assert.equal(s.activeStreams.state,'absent');assert.match(s.view.details.find(d=>d.label==='Ingestion / continuation')!.value,/absent.*unknown/);
});

const audit = (id: string, at: string, outcome = 'complete', trigger = 'manual') => ({
  id, attempted_at: at, outcome, trigger, finished_at: outcome === 'attempted' ? null : at,
});
const run = (id: string, at: string, status = 'error', more: boolean | null = null) => ({
  id, started_at: at, status, finished_at: status === 'running' ? null : at, matter_has_more: more,
});
const attemptDetail = (s: ReturnType<typeof derive>) => s.view.details[0].value;
const earlier = '2026-10-15T10:00:00Z', later = '2026-10-15T11:00:00Z';
test('newer failed or unfinished run cannot be hidden by an older successful audit', () => {
  for (const status of ['error', 'running']) {
    const i = inputs(); i.attempts = known([audit('private-old', earlier)]);
    i.runs = known([run('private-new', later, status)]);
    const s = derive(i); assert.ok(s.lastAttempt.state === 'known');
    assert.equal(s.lastAttempt.value.evidence, 'run log'); assert.equal(s.lastAttempt.value.trigger, 'unknown');
    assert.match(attemptDetail(s), status === 'error' ? /error/ : /unknown \(unfinished log\)/);
    assert.doesNotMatch(attemptDetail(s), /complete|private/);
    assert.deepEqual(s.sessions, derive(inputs()).sessions); assert.equal(s.derived, derive(inputs()).derived);
    assert.equal(s.freshness, 'stale');
  }
});
test('exact ID correlation retains audit trigger/outcome despite normal audit-before-run ordering', () => {
  for (const [outcome, status, more] of [['complete', 'success', false], ['partial', 'success', true], ['error', 'error', null], ['complete', 'running', null]] as const) {
    const i = inputs(); i.attempts = known([audit('private-shared', earlier, outcome, 'scheduled')]);
    i.runs = known([run('private-shared', later, status, more)]);
    const s = derive(i); assert.ok(s.lastAttempt.state === 'known');
    assert.deepEqual(s.lastAttempt.value, { attemptedAt: earlier, outcome, trigger: 'scheduled', evidence: 'invocation + run log' });
    assert.doesNotMatch(JSON.stringify(s), /private-shared/);
  }
});
test('an initial-only correlated audit retains trigger but uses failed/unfinished run evidence', () => {
  for (const status of ['error', 'running', 'success']) {
    const i = inputs(); i.attempts = known([audit('private-shared', earlier, 'attempted', 'scheduled')]);
    i.runs = known([run('private-shared', later, status)]);
    const s = derive(i); assert.ok(s.lastAttempt.state === 'known'); assert.equal(s.lastAttempt.value.trigger, 'scheduled');
    assert.match(s.lastAttempt.value.outcome, status === 'error' ? /error/ : status === 'running' ? /unknown/ : /cycle completion not established/);
    assert.equal(s.freshness, 'stale'); assert.doesNotMatch(JSON.stringify(s), /private-shared/);
  }
});
test('conflicting correlated outcomes remain explicit instead of presenting a success', () => {
  const i = inputs(); i.attempts = known([audit('shared', earlier)]); i.runs = known([run('shared', later)]);
  assert.match(attemptDetail(derive(i)), /Conflicting outcomes: invocation complete; run log error/);
});
test('newer audit-only skipped attempts win even if the older correlated run was created later', () => {
  for (const outcome of ['skipped_locked', 'skipped_rate_limited']) {
    const i = inputs(); i.attempts = known([audit('private-new', later, outcome, 'scheduled'), audit('private-old', earlier)]);
    i.runs = known([run('private-old', '2026-10-15T11:01:00Z', 'success', false)]);
    const s = derive(i); assert.ok(s.lastAttempt.state === 'known'); assert.equal(s.lastAttempt.value.outcome, outcome);
    assert.equal(s.lastAttempt.value.evidence, 'invocation'); assert.equal(s.lastAttempt.value.trigger, 'scheduled');
  }
});
test('close timestamps never correlate distinct IDs; equal/invalid/sub-millisecond ordering stays explicit', () => {
  const i = inputs(); i.attempts = known([audit('private-audit', earlier)]);
  i.runs = known([run('private-run', '2026-10-15T10:00:00.001Z')]);
  let s = derive(i); assert.ok(s.lastAttempt.state === 'known'); assert.equal(s.lastAttempt.value.trigger, 'unknown');
  for (const at of [earlier, 'not-an-instant', '2026-10-15T10:00:00.000001Z']) {
    i.runs = known([run('private-run', at)]); s = derive(i);
    assert.equal(s.lastAttempt.state, 'uncertain'); assert.match(attemptDetail(s), /ordering ambiguous/);
    assert.match(attemptDetail(s), /error/); assert.doesNotMatch(JSON.stringify(s), /private-audit|private-run/);
  }
  i.runs = known([run('private-audit', earlier, 'success', false)]);
  assert.equal(derive(i).lastAttempt.state, 'known'); // Equal timestamps are safe only with exact identity.
  i.attempts = known([audit('first', earlier), audit('second', earlier, 'error', 'scheduled')]); i.runs = known([]);
  assert.equal(derive(i).lastAttempt.state, 'uncertain');
});
test('either source unavailable qualifies available evidence and cannot claim a latest successful attempt', () => {
  for (const source of ['attempts', 'runs'] as const) {
    const i = inputs(); i[source] = unavailable; const s = derive(i);
    assert.equal(s.lastAttempt.state, 'uncertain'); assert.match(attemptDetail(s), /Latest attempt unknown.*unavailable/);
    assert.match(attemptDetail(s), /Available observations/); assert.equal(s.hasUnavailableSections, true);
    i.attempts = unavailable; i.runs = unavailable; assert.equal(derive(i).lastAttempt.state, 'unavailable');
  }
});
test('actual bounded loader exposes tied runs and failure of either source while preserving privacy', async () => {
  for (const fail of [undefined, 'sync_runs', 'matter_invocation_status']) {
    const { client, requests } = cappedPostgrest({
      matter_invocation_status: [audit('private-audit', earlier)],
      sync_runs: [run('private-success', later, 'success', false), run('private-error', later), run('private-older', earlier)],
    }, { respond: ({ table }) => table === fail ? Response.json({ message: 'private-db-error' }, { status: 500 }) : undefined });
    const s = await loadSyncStatus(client, now, 'Europe/Athens');
    assert.equal(s.lastAttempt.state, 'uncertain');
    assert.match(attemptDetail(s), fail ? /unavailable/ : /ordering ambiguous/);
    if (fail !== 'sync_runs') assert.match(attemptDetail(s), /error/);
    assert.doesNotMatch(JSON.stringify(s), /private-/);
    const query = requests.find(r => r.table === 'sync_runs')!;
    assert.equal(query.url.searchParams.get('select'), 'id,started_at,finished_at,status,matter_has_more');
    assert.equal(query.url.searchParams.get('limit'), '2');
    assert.equal(query.url.searchParams.get('order'), 'started_at.desc,id.asc');
    assert.equal(requests.length, 11);
  }
});

test('26A continuation distinguishes safe checkpoint, backoff, manual recovery and enumeration',()=>{
  const i=inputs();i.streams=known([{stream:'recent_sessions',cycle_active:true,cycle_started_at:completed,completed_watermark:completed,retry_at:null,coverage_window:'all',transition_status:'native'}]);
  const retryText=()=>derive(i).view.details.find(d=>d.label==='Retry / cooldown')!.value;
  assert.match(retryText(),/safe checkpoint eligible for scheduled continuation/);
  i.retry=known({nextEligibleAt:'2026-10-15T12:05:00Z',manualRecovery:false,pendingRequests:1});
  assert.match(retryText(),/waiting for cooldown\/backoff/);assert.doesNotMatch(retryText(),/safe checkpoint/);
  i.retry=known({nextEligibleAt:'2026-10-15T12:05:00Z',manualRecovery:true,pendingRequests:1});
  assert.match(retryText(),/Next eligible.*15 Oct 2026, 15:05.*deliberate manual recovery/);
  i.retry=known({nextEligibleAt:null,manualRecovery:true,pendingRequests:1});
  assert.match(retryText(),/expiry does not enable automatic recovery/);assert.doesNotMatch(retryText(),/safe checkpoint/);
  i.continuation=known({history_status:'running',requested_at:completed});
  assert.match(derive(i).view.details.find(d=>d.label==='Session history intent')!.value,/running/);
  i.continuation=known({history_status:'complete',requested_at:completed});
  assert.match(derive(i).view.details.find(d=>d.label==='Session history intent')!.value,/complete.*available-session enumeration only/);
});
