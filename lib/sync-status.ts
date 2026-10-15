import estimation from "./estimation-contract.json";
import type { MatterStatsSupabaseClient } from './supabase-queries';
import type { MatterSyncStream, Tables } from './supabase-types';

/** A successful query with no evidence is different from a failed query. */
export type Evidence<T> = { state: 'known'; value: T } | { state: 'absent' | 'unavailable' };
export const known = <T>(value: T): Evidence<T> => ({ state: 'known', value });
export const unavailable = { state: 'unavailable' } as const;
export const absent = { state: 'absent' } as const;
export type Completion = { state: 'known'; at: string; sourceBoundary: string } | { state: 'unknown' | 'never' | 'unavailable' };
export type GenerationEvidence = {
  activeId: string | null; epoch: string; frozen: boolean; rolledBack: boolean;
  active: { id: string; state: string; timezone: string; wordMethod: string; calendarMethod: string; readinessAt: string | null; reconciled: boolean; baseline: boolean; cutover: boolean } | null;
  candidate: { state: string; timezone: string; readinessAt: string | null; reconciled: boolean; pendingChanges: boolean } | null;
};
type RetryEvidence = { nextEligibleAt: string | null; manualRecovery: boolean; pendingRequests: number };
type Attempt = { attemptedAt: string; outcome: string; trigger: string; evidence: 'invocation' | 'run log' | 'invocation + run log' };
type AttemptEvidence = Evidence<Attempt> | { state: 'uncertain'; reason: string; observations: Attempt[] };
type RunEvidence = Pick<Tables<'sync_runs'>, 'id' | 'started_at' | 'finished_at' | 'status' | 'matter_has_more'>;
export type StatusInputs = {
  streams: Evidence<Pick<MatterSyncStream, 'stream' | 'cycle_active' | 'cycle_started_at' | 'completed_watermark' | 'retry_at' | 'coverage_window' | 'transition_status'>[]>;
  completions: Evidence<Tables<'matter_cycle_completions'>[]>;
  attempts: Evidence<Tables<'matter_invocation_status'>[]>;
  runs: Evidence<RunEvidence[]>;
  newestSession: Evidence<string>;
  continuation: Evidence<{ history_status: string; requested_at: string | null }>;
  lease: Evidence<{ occupied: boolean; expiresAt: string | null }>;
  retry: Evidence<RetryEvidence>;
  legacyCooldown: Evidence<string>;
  dirtyRollups: Evidence<number>;
  generation: Evidence<GenerationEvidence>;
};
export type SyncStatus = ReturnType<typeof deriveSyncStatus>;
export type StatusView = { summary: string; warning: boolean; details: Array<{ label: string; value: string }> };

export function staleHours(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.MATTER_SYNC_STALE_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 36;
}
export function statusTimestamp(value: string, timezone: string): string {
  if (!Number.isFinite(Date.parse(value))) return 'Unknown';
  return `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value))} (${timezone})`;
}

function runOutcome(run: RunEvidence): string {
  return run.status === 'success' ? run.matter_has_more === true ? 'partial' : 'success (cycle completion not established)'
    : run.status === 'running' ? 'outcome unknown (unfinished log)' : run.status;
}

/** IDs are used only here for exact correlation; never returned to the client.
 * An audit starts before its run, so correlated records use the audit start.
 * Legacy/different IDs are independent evidence, regardless of time proximity.
 */
function selectLastAttempt(attempts: StatusInputs['attempts'], runs: StatusInputs['runs']): AttemptEvidence {
  const audits = attempts.state === 'known' ? attempts.value : [];
  const logs = runs.state === 'known' ? runs.value : [];
  const observations: Attempt[] = audits.map(a => {
    const run = logs.find(r => r.id === a.id);
    let outcome = a.outcome;
    if (run && a.outcome === 'attempted') outcome = runOutcome(run);
    // A terminal audit may follow a running-row snapshot. An error row cannot
    // support a contradictory successful audit, even when the IDs match.
    else if (run && (run.status === 'error' && a.outcome !== 'error'
      || run.status === 'success' && a.outcome.startsWith('skipped_'))) {
      outcome = `Conflicting outcomes: invocation ${a.outcome}; run log ${runOutcome(run)}`;
    }
    return { attemptedAt: a.attempted_at, outcome, trigger: a.trigger, evidence: run ? 'invocation + run log' : 'invocation' };
  });
  for (const run of logs) {
    if (!audits.some(a => a.id === run.id)) observations.push({ attemptedAt: run.started_at,
      outcome: runOutcome(run), trigger: 'unknown', evidence: 'run log' });
  }
  const missing = attempts.state === 'unavailable' || runs.state === 'unavailable';
  if (!observations.length) return missing ? unavailable : absent;
  const invalid = observations.some(a => !Number.isFinite(Date.parse(a.attemptedAt)));
  const latest = invalid ? observations : observations.filter(a => Date.parse(a.attemptedAt)
    === Math.max(...observations.map(a => Date.parse(a.attemptedAt))));
  if (missing || invalid || latest.length !== 1) return { state: 'uncertain', observations: latest,
    reason: missing ? 'Latest attempt unknown: invocation or run evidence unavailable'
      : 'Latest attempt unknown: timestamp ordering ambiguous' };
  return known(latest[0]);
}

function attemptText(attempt: Attempt, timezone: string): string {
  return `${statusTimestamp(attempt.attemptedAt,timezone)} · ${attempt.outcome} · trigger ${attempt.trigger} (${attempt.evidence})`;
}

export function deriveSyncStatus(input: StatusInputs, now: Date, timezone: string, thresholdHours = staleHours()) {
  const ms = now.getTime();
  const completion = (stream: string): Completion => {
    if (input.completions.state === 'unavailable') return { state: 'unavailable' };
    const row = input.completions.state === 'known' ? input.completions.value.find(r => r.stream === stream) : undefined;
    if (row) return Number.isFinite(Date.parse(row.completed_at)) && Date.parse(row.completed_at) <= ms
      ? { state: 'known', at: row.completed_at, sourceBoundary: row.source_boundary } : { state: 'unknown' };
    if (input.streams.state === 'unavailable') return { state: 'unavailable' };
    const state = input.streams.state === 'known' ? input.streams.value.find(s => s.stream === stream) : undefined;
    // A native seed is explicit never-completed evidence. Missing/migrated state
    // or an old watermark cannot establish a historical completion timestamp.
    return { state: state && !state.completed_watermark && state.transition_status === 'native' ? 'never' : 'unknown' };
  };
  const sessions = completion('recent_sessions'), metadata = completion('library_items');
  const freshness = sessions.state === 'known'
    ? ms - Date.parse(sessions.at) >= thresholdHours * 3_600_000 ? 'stale' : 'fresh'
    : sessions.state;
  const lastAttempt = selectLastAttempt(input.attempts, input.runs);
  const lease = input.lease.state === 'known' ? known({ state: !input.lease.value.occupied ? 'idle' : input.lease.value.expiresAt && Date.parse(input.lease.value.expiresAt) > ms ? 'active' : 'expired', expiresAt: input.lease.value.expiresAt }) : input.lease;
  const activeStreams = input.streams.state === 'known' && !['recent_sessions','library_items'].every(name => input.streams.state === 'known' && input.streams.value.some(s => s.stream === name)) ? absent : input.streams.state === 'known' ? known(input.streams.value.filter(s=>s.cycle_active).map(s=>({stream:s.stream, startedAt:s.cycle_started_at, window:s.coverage_window}))) : input.streams;
  const deadlines = [input.retry.state === 'known' ? input.retry.value.nextEligibleAt : null,
    input.legacyCooldown.state === 'known' ? input.legacyCooldown.value : null,
    ...(input.streams.state === 'known' ? input.streams.value.map(s=>s.retry_at) : [])]
    .filter((v): v is string => !!v && Number.isFinite(Date.parse(v)) && Date.parse(v)>ms).sort((a,b)=>Date.parse(b)-Date.parse(a));
  const retry = input.retry.state === 'unavailable' || input.legacyCooldown.state === 'unavailable' || activeStreams.state !== 'known'
    ? unavailable : known({nextEligibleAt:deadlines[0] ?? null, manualRecovery:input.retry.state === 'known' && input.retry.value.manualRecovery, pendingRequests:input.retry.state === 'known' ? input.retry.value.pendingRequests : 0});
  const gen = input.generation.state === 'known' ? input.generation.value : null;
  const derived = input.generation.state !== 'known' || input.dirtyRollups.state !== 'known' ? 'unavailable'
    : gen?.frozen ? 'writer barrier frozen' : input.dirtyRollups.value > 0 ? 'pending dirty rollups'
    : gen?.candidate ? `historical repair ${gen.candidate.state}; not applied`
    : !gen?.active?.reconciled || !gen.active.cutover ? 'legacy / unverified'
    : gen.active.timezone !== timezone ? 'timezone mismatch'
    : gen.active.wordMethod !== estimation.wordMethod || gen.active.calendarMethod !== estimation.calendarMethod ? 'calculation method mismatch' : 'ready';
  const completionText = (c: Completion) => c.state === 'known' ? statusTimestamp(c.at,timezone) : c.state === 'never' ? 'Never completed' : c.state === 'unknown' ? 'Unknown completion time' : 'Unavailable';
  const summary = freshness === 'fresh' ? 'Sessions completion is recent' : freshness === 'stale' ? 'Sessions completion is stale'
    : freshness === 'never' ? 'No completed sessions synchronization yet' : freshness === 'unknown' ? 'Sessions completion time unknown' : 'Sessions status unavailable';
  const details: StatusView['details'] = [
    {label:'Last recorded invocation attempt',value:lastAttempt.state === 'known' ? attemptText(lastAttempt.value,timezone)
      : lastAttempt.state === 'uncertain' ? `${lastAttempt.reason}. Available observations: ${lastAttempt.observations.map(a => attemptText(a,timezone)).join('; ')}`
      : lastAttempt.state === 'absent' ? 'No recorded invocation; unrecorded attempts unknown' : 'Unavailable; latest attempt unknown'},
    {label:'Last completed sessions cycle',value:completionText(sessions)},
    {label:'Last completed metadata cycle',value:completionText(metadata)},
    {label:'Sessions freshness policy',value:`Warning at elapsed time ≥ ${thresholdHours} hours since proven sessions completion`},
    {label:'Sessions source boundary',value:sessions.state === 'known' ? statusTimestamp(sessions.sourceBoundary,timezone) : sourceBoundary(input,'recent_sessions',timezone)},
    {label:'Metadata source boundary',value:metadata.state === 'known' ? statusTimestamp(metadata.sourceBoundary,timezone) : sourceBoundary(input,'library_items',timezone)},
    {label:'Newest imported session occurrence',value:input.newestSession.state === 'known' ? statusTimestamp(input.newestSession.value,timezone) : input.newestSession.state === 'absent' ? 'No dated imported sessions' : 'Unavailable'},
    {label:'Ingestion / continuation',value:activeStreams.state === 'known' ? activeStreams.value.length ? `Partial ingestion; pending continuation: ${activeStreams.value.map(s=>`${s.stream} (${s.window ?? 'pinned scope'})`).join(', ')}` : 'No active stream cycle' : activeStreams.state === 'absent' ? 'Stream state absent; continuation unknown' : 'Unavailable'},
    {label:'Session history intent',value:input.continuation.state === 'known' ? `${input.continuation.value.history_status} · available-session enumeration only` : 'Unavailable'},
    {label:'Lease',value:lease.state === 'known' ? `${lease.value.state}${lease.value.expiresAt ? ` · expiry ${statusTimestamp(lease.value.expiresAt,timezone)}` : ''}. Lease validity does not prove worker progress.` : 'Unavailable'},
    {label:'Retry / cooldown',value:retry.state === 'known' ? `${retry.value.nextEligibleAt ? `Next eligible ${statusTimestamp(retry.value.nextEligibleAt,timezone)}` : 'No future cooldown recorded'}; ${retry.value.pendingRequests} pending request chains${retry.value.manualRecovery ? '; deliberate manual recovery required' : ''}` : 'Unavailable'},
    {label:'Pending dirty rollups',value:input.dirtyRollups.state === 'known' ? `${input.dirtyRollups.value} dates` : 'Unavailable'},
    {label:'Analytics reader',value:`Overview / Activity / Reports calculate canonical values from imported raw sessions: round each session duration / 60 × 225, then sum; local occurrence day in ${timezone}. Historical persisted repair does not gate these metrics. Query failures are shown by the serving page.`},
    {label:'Persisted derived readiness',value:derived},
    {label:'Active derived generation',value:gen ? `${gen.activeId ?? 'legacy'} · epoch ${gen.epoch}${gen.rolledBack ? ' · rollback applied' : gen.active?.cutover ? ' · active cutover applied' : ''}${gen.active ? ` · ${gen.active.timezone} · ${gen.active.wordMethod} · ${gen.active.calendarMethod}` : ''}` : 'Unavailable'},
    {label:'Active reconciliation evidence time',value:gen?.active?.reconciled && gen.active.cutover && gen.active.readinessAt ? `${statusTimestamp(gen.active.readinessAt,timezone)} · active generation reconciliation; current readiness also requires no pending work` : gen ? 'Unknown; no proven active canonical reconciliation time' : 'Unavailable'},
    {label:'Current derived readiness time',value:gen ? 'Unknown; no durable timestamp records when the last dirty acknowledgement made current data ready.' : 'Unavailable'},
    {label:'Historical repair',value:gen ? gen.candidate ? `${gen.candidate.state}${gen.candidate.reconciled && !gen.candidate.pendingChanges ? ' · reconciled candidate' : ' · reconciliation unresolved'}; not applied${gen.frozen ? ' · session/daily writers frozen' : ''}` : `No candidate${gen.frozen ? ' · session/daily writers frozen' : ''}` : 'Unavailable'},
    {label:'Upstream historical coverage',value:'Unverified. Imported dates/counts, incremental exhaustion and local reconciliation do not prove complete Matter history.'},
    {label:'Session-to-item attribution',value:'Unsupported for sessions without a documented item identifier. Another metadata sync is not guaranteed to resolve attribution.'},
    {label:'Scheduled execution',value:input.attempts.state === 'known' && input.attempts.value.some(a=>a.trigger==='scheduled') ? 'A scheduled-trigger invocation was observed; delivery reliability and production verification remain external gates.' : input.attempts.state === 'unavailable' ? 'Observation unavailable; cron configuration is not execution evidence.' : 'Cron configured for 06:00 UTC; no reliable scheduled-trigger evidence recorded. Production verification remains external.'},
  ];
  return { sessions, metadata, freshness, lastAttempt, lease, activeStreams, retry, derived, hasUnavailableSections: Object.values(input).some(e => e.state === 'unavailable'), coverage:'unverified' as const,
    view:{summary:`${summary} · Metadata: ${completionText(metadata)} · Coverage unverified`,warning:freshness!=='fresh',details} };
}

function sourceBoundary(input: StatusInputs, name: string, timezone: string) {
  if (input.streams.state === 'unavailable') return 'Unavailable';
  const value = input.streams.state === 'known' ? input.streams.value.find(s => s.stream === name)?.completed_watermark : null;
  return value ? `${statusTimestamp(value, timezone)} · source boundary only; completion time unknown` : 'No recorded source boundary';
}

/** Server request-owned, bounded reads. Every section checks error/null data. */
export async function loadSyncStatus(client: MatterStatsSupabaseClient, now: Date, timezone: string, thresholdHours = staleHours()): Promise<SyncStatus> {
  const read = readStatusEvidence;
  const [streams,completions,attempts,runs,newest,continuation,lease,retry,legacy,dirty,generation] = await Promise.all([
    read(client.from('matter_sync_streams').select('stream,cycle_active,cycle_started_at,completed_watermark,retry_at,coverage_window,transition_status').limit(2)),
    read(client.from('matter_cycle_completions').select('stream,cycle_generation,source_boundary,completed_at').limit(2)),
    read(client.from('matter_invocation_status').select('trigger,id,attempted_at,outcome,finished_at').limit(3)),
    // Two rows expose tied latest starts instead of silently choosing one.
    read(client.from('sync_runs').select('id,started_at,finished_at,status,matter_has_more').order('started_at',{ascending:false}).order('id').limit(2)),
    read(client.from('reading_sessions').select('started_at').not('started_at','is',null).order('started_at',{ascending:false}).limit(1).maybeSingle()),
    read(client.from('matter_sync_continuation').select('history_status,requested_at').eq('account_scope','matter').single()),
    // No owner token is selected. expires_at is set exactly when occupied.
    read(client.from('matter_sync_leases').select('expires_at').eq('account_scope','matter').single()),
    read(client.rpc('read_matter_retry_status',{p_now:now.toISOString()})),
    read(client.from('sync_state').select('rate_limited_until').eq('id','matter').maybeSingle()),
    readStatusCount(client.from('matter_dirty_rollups').select('date',{count:'exact',head:true})),
    read(client.rpc('read_matter_generation_status',{})),
  ]);
  const map = <T,U>(e:Evidence<T>,fn:(v:T)=>U):Evidence<U> => e.state === 'known' ? known(fn(e.value)) : e;
  return deriveSyncStatus({streams,completions,attempts,runs,newestSession:map(newest,v=>v.started_at!),
    continuation:continuation.state === 'absent' ? unavailable : continuation,
    lease:lease.state === 'known' ? known({occupied:!!lease.value.expires_at,expiresAt:lease.value.expires_at}) : unavailable,
    retry:retry.state === 'known' && validRetry(retry.value) ? known(retry.value) : unavailable,
    legacyCooldown:legacy.state === 'known' ? legacy.value.rate_limited_until ? known(legacy.value.rate_limited_until) : absent : legacy,
    dirtyRollups:dirty,generation:generation.state === 'known' && validGeneration(generation.value) ? known(generation.value) : unavailable},now,timezone,thresholdHours);
}
export async function readStatusEvidence<T>(query: PromiseLike<{data:T;error:unknown}>): Promise<Evidence<NonNullable<T>>> {
  try { const r = await query; return r.error ? unavailable : r.data === null ? absent : known(r.data as NonNullable<T>); }
  catch { return unavailable; }
}
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function nullableInstant(v: unknown): boolean { return v === null || typeof v === 'string' && Number.isFinite(Date.parse(v)); }
function validRetry(v: unknown): v is RetryEvidence {
  return object(v) && Number.isSafeInteger(v.pendingRequests) && Number(v.pendingRequests) >= 0
    && typeof v.manualRecovery === 'boolean' && nullableInstant(v.nextEligibleAt);
}
function validGeneration(v: unknown): v is GenerationEvidence {
  if (!object(v) || typeof v.epoch !== 'string' || !/^\d+$/.test(v.epoch) || typeof v.frozen !== 'boolean'
    || typeof v.rolledBack !== 'boolean' || !(v.activeId === null || typeof v.activeId === 'string')) return false;
  if (v.active !== null && (!object(v.active) || v.active.id !== v.activeId || typeof v.active.state !== 'string'
    || typeof v.active.timezone !== 'string' || typeof v.active.wordMethod !== 'string' || typeof v.active.calendarMethod !== 'string'
    || typeof v.active.reconciled !== 'boolean' || typeof v.active.cutover !== 'boolean' || !nullableInstant(v.active.readinessAt))) return false;
  if (v.activeId !== null && v.active === null) return false;
  return v.candidate === null || object(v.candidate) && typeof v.candidate.state === 'string' && typeof v.candidate.timezone === 'string'
    && typeof v.candidate.reconciled === 'boolean' && typeof v.candidate.pendingChanges === 'boolean' && nullableInstant(v.candidate.readinessAt);
}
export async function readStatusCount(query:PromiseLike<{count:number|null;error:unknown}>):Promise<Evidence<number>> {
  try { const {count,error}=await query; return error || count===null || !Number.isSafeInteger(count) || count<0 ? unavailable : known(count); } catch { return unavailable; }
}
export function unavailableSyncStatus(now:Date,timezone:string) {
  return deriveSyncStatus({streams:unavailable,completions:unavailable,attempts:unavailable,runs:unavailable,newestSession:unavailable,continuation:unavailable,lease:unavailable,retry:unavailable,legacyCooldown:unavailable,dirtyRollups:unavailable,generation:unavailable},now,timezone);
}
