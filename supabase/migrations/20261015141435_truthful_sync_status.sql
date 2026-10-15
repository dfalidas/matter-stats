-- Task 21. No historical timestamps are inferred or backfilled.
create table public.matter_cycle_completions (
 stream text primary key check(stream in ('recent_sessions','library_items')),
 cycle_generation bigint not null, source_boundary timestamptz not null,
 completed_at timestamptz not null
);
-- At most one latest invocation per explicit trigger. Logging is independent
-- of ingestion ownership: a skipped-locked attempt must be recordable too.
create table public.matter_invocation_status (
 trigger text primary key check(trigger in ('manual','scheduled','unknown')),
 id uuid not null, attempted_at timestamptz not null,
 outcome text not null check(outcome in ('attempted','complete','partial','error','skipped_locked','skipped_rate_limited')),
 finished_at timestamptz
);
alter table public.matter_cycle_completions enable row level security;
alter table public.matter_invocation_status enable row level security;
revoke all on public.matter_cycle_completions,public.matter_invocation_status from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.matter_cycle_completions,public.matter_invocation_status to service_role;
comment on table public.matter_cycle_completions is 'Actual database observation of validated terminal-page commit, atomic with its receipt. Source boundary is not completion time. No legacy backfill.';
comment on table public.matter_invocation_status is 'Bounded invocation audit only. Neither attempted nor complete outcome certifies stream completion or worker liveness.';

-- Receipts are written only after the validated, fenced page transition. Replay
-- returns before this write; rollback of any page operation also rolls this back.
create function public.record_matter_cycle_completion() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare s public.matter_sync_streams;
begin
 select * into strict s from public.matter_sync_streams where stream=new.stream;
 if not s.cycle_active and s.completed_watermark is not null then
  insert into public.matter_cycle_completions(stream,cycle_generation,source_boundary,completed_at)
   values(s.stream,s.cycle_generation,s.completed_watermark,clock_timestamp())
   on conflict(stream) do update set cycle_generation=excluded.cycle_generation,
    source_boundary=excluded.source_boundary,completed_at=excluded.completed_at
   where public.matter_cycle_completions.cycle_generation<excluded.cycle_generation;
 end if;
 return new;
end; $$;
create trigger record_matter_cycle_completion after insert or update on public.matter_page_receipts
 for each row execute function public.record_matter_cycle_completion();

create function public.record_matter_invocation(p_id uuid,p_trigger text,p_outcome text) returns void
language plpgsql volatile security invoker set search_path='' as $$
begin
 if p_id is null or p_trigger is null or p_trigger not in ('manual','scheduled','unknown') or p_outcome is null
  or p_outcome not in ('attempted','complete','partial','error','skipped_locked','skipped_rate_limited') then
  raise exception 'Invalid invocation evidence' using errcode='22023'; end if;
 if p_outcome='attempted' then
  insert into public.matter_invocation_status(trigger,id,attempted_at,outcome)
   values(p_trigger,p_id,clock_timestamp(),p_outcome)
   on conflict(trigger) do update set id=excluded.id,attempted_at=excluded.attempted_at,outcome=excluded.outcome,finished_at=null;
 else
  -- A late result cannot overwrite a newer attempt of the same trigger.
  update public.matter_invocation_status set outcome=p_outcome,finished_at=clock_timestamp()
   where trigger=p_trigger and id=p_id and outcome='attempted';
 end if;
end; $$;

-- One SQL snapshot pins pointer, version labels, barrier and reconciliation.
-- No opaque owner, cursor, source payload or credentials leave this function.
create function public.read_matter_generation_status() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('activeId',c.active,'epoch',c.epoch::text,'frozen',c.frozen is not null,
  'active', (select jsonb_build_object('id',g.id,'state',g.state,'timezone',g.timezone,'wordMethod',g.word_method,
   'calendarMethod',g.calendar_method,'readinessAt',g.completed_at,'reconciled',g.reconciliation is not null and g.invalid_rows=0 and g.mismatches=0,
   'baseline',g.refresh_original_days,'cutover',g.cutover_epoch is not null) from public.reading_generations g where g.id=c.active),
  'candidate',(select jsonb_build_object('state',g.state,'timezone',g.timezone,'readinessAt',g.completed_at,
   'reconciled',g.reconciled_revision=c.source_revision and g.reconciled_epoch=c.epoch and g.invalid_rows=0 and g.mismatches=0,
   'pendingChanges',exists(select 1 from public.reading_repair_changes r where r.generation=g.id))
   from public.reading_generations g where g.id=c.building),
  'rolledBack',exists(select 1 from public.reading_generations g where g.id=c.previous and g.rollback_epoch=c.epoch))
 from public.reading_generation_control c where c.singleton;
$$;

-- Reduce bounded durable preparation (3 slots x <=256 entries) in SQL; never
-- download cached upstream bodies to calculate local status. Eligibility is
-- not a scheduling promise; exhausted/ambiguous chains need manual recovery.
create function public.read_matter_retry_status(p_now timestamptz) returns jsonb
language sql stable security invoker set search_path='' as $$
 with entries as (select e.value from public.matter_request_work w cross join lateral jsonb_each(w.requests) e),
 retry as (select max((value->>'next_at')::timestamptz) deadline,
  coalesce(bool_or(value->>'pending'='true' or (value->>'attempts')::integer>=3 or value ? 'protocol' or value ? 'status'),false) manual,
  count(*) filter(where not(value ? 'value')) pending
  from entries where not(value ? 'value'))
 select jsonb_build_object('nextEligibleAt',greatest(r.deadline,q.not_before,
  case when q.feedback_remaining=0 then q.feedback_until end,
  case when cardinality(q.read_starts)>=120 then q.read_starts[1]+interval '60 seconds' end,
  case when cardinality(q.burst_starts)>=5 then q.burst_starts[1]+interval '1 second' end),
  'manualRecovery',r.manual,'pendingRequests',r.pending)
 from retry r cross join public.matter_quota q where q.account_scope='matter' and p_now is not null;
$$;
revoke all on function public.record_matter_cycle_completion(),public.record_matter_invocation(uuid,text,text),public.read_matter_generation_status(),public.read_matter_retry_status(timestamptz) from public,anon,authenticated;
grant execute on function public.record_matter_cycle_completion(),public.record_matter_invocation(uuid,text,text),public.read_matter_generation_status(),public.read_matter_retry_status(timestamptz) to service_role;
