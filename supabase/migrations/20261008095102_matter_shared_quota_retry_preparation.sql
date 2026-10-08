-- Task 15 / F2 / W4 / R3,R4. Additive; apply before code, with ingress drained.
-- The single-user app deliberately shares one scope even before /me. No token is stored.
create table public.matter_quota (
 account_scope text primary key check(account_scope='matter'),
 read_starts timestamptz[] not null default '{}',
 burst_starts timestamptz[] not null default '{}',
 markdown_starts timestamptz[] not null default '{}',
 sequence bigint not null default 0 check(sequence>=0),
 not_before timestamptz,
 feedback_until timestamptz,
 feedback_remaining integer check(feedback_remaining>=0),
 check(cardinality(read_starts)<=120 and cardinality(burst_starts)<=5 and cardinality(markdown_starts)<=20)
);
create table public.matter_request_work (
 slot text primary key check(slot in ('bootstrap','recent_sessions','library_items')),
 contract jsonb,
 requests jsonb not null default '{}',
 cursor_generation bigint,
 cursor_hashes text[] not null default '{}',
 check(jsonb_typeof(requests)='object' and octet_length(requests::text)<=8388608),
 check(cardinality(cursor_hashes)<=10000)
);
alter table public.matter_quota enable row level security;
alter table public.matter_request_work enable row level security;
revoke all on public.matter_quota,public.matter_request_work from public,anon,authenticated,service_role;
grant select,update on public.matter_quota,public.matter_request_work to service_role;
insert into public.matter_quota(account_scope,not_before) select 'matter',max(deadline) from (select retry_at deadline from public.matter_sync_streams union all select rate_limited_until from public.sync_state where id='matter') prior;
insert into public.matter_request_work(slot) values('bootstrap'),('recent_sessions'),('library_items');
comment on table public.matter_quota is 'Exact rolling 60-second GET/markdown and 1-second burst reservations, bounded arrays and monotone feedback. Participating Matter Stats consumers only.';
comment on table public.matter_request_work is 'Three bounded slots; two fenced page preparations, successful HTTP read cache and durable retry chains. Separate from committed ingestion. Never TTL-reset an exhausted chain.';

create function public.prepare_matter_request_work(p_account_scope text,p_owner uuid,p_generation bigint,p_expected jsonb)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare s public.matter_sync_streams; e public.matter_sync_streams; w public.matter_request_work;
begin
 perform public.assert_matter_sync_lease(p_account_scope,p_owner,p_generation);
 if jsonb_typeof(p_expected) is distinct from 'object' or octet_length(p_expected::text)>16384 then raise exception 'Invalid preparation' using errcode='22023'; end if;
 e:=jsonb_populate_record(null::public.matter_sync_streams,p_expected);
 select * into strict s from public.matter_sync_streams where stream=e.stream for update;
 if not s.cycle_active or row(s.endpoint,s.filters,s.page_limit,s.cursor,s.cycle_started_at,s.cycle_generation,s.completed_watermark,s.coverage_window,s.transition_status)
 is distinct from row(e.endpoint,e.filters,e.page_limit,e.cursor,e.cycle_started_at,e.cycle_generation,e.completed_watermark,e.coverage_window,e.transition_status)
 then raise exception 'Stale preparation' using errcode='PT409'; end if;
 select * into strict w from public.matter_request_work where slot=s.stream for update;
 if w.contract is distinct from p_expected then
  update public.matter_request_work set contract=p_expected,requests='{}',cursor_generation=s.cycle_generation,
   cursor_hashes=case when w.cursor_generation=s.cycle_generation then w.cursor_hashes else '{}'::text[] end where slot=s.stream;
 end if;
end; $$;

-- Pure rolling-window evaluator permits exact injected-clock SQL tests. It
-- cannot reserve or mutate capacity; admission supplies locked state/DB time.
create function public.evaluate_matter_quota(p_state jsonb,p_now timestamptz,p_markdown boolean)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare q public.matter_quota; deadline timestamptz;
begin
 if p_now is null or p_markdown is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'Invalid quota evaluation' using errcode='22023'; end if;
 q:=jsonb_populate_record(null::public.matter_quota,p_state);
 if q.account_scope is distinct from 'matter' or q.read_starts is null or q.burst_starts is null or q.markdown_starts is null
 or cardinality(q.read_starts)>120 or cardinality(q.burst_starts)>5 or cardinality(q.markdown_starts)>20 then raise exception 'Invalid quota state' using errcode='22023'; end if;
 q.read_starts:=array(select t from unnest(q.read_starts) t where t>p_now-interval '60 seconds' order by t);
 q.burst_starts:=array(select t from unnest(q.burst_starts) t where t>p_now-interval '1 second' order by t);
 q.markdown_starts:=array(select t from unnest(q.markdown_starts) t where t>p_now-interval '60 seconds' order by t);
 deadline:=q.not_before;
 if cardinality(q.read_starts)>=120 then deadline:=greatest(deadline,q.read_starts[1]+interval '60 seconds'); end if;
 if cardinality(q.burst_starts)>=5 then deadline:=greatest(deadline,q.burst_starts[1]+interval '1 second'); end if;
 if p_markdown and cardinality(q.markdown_starts)>=20 then deadline:=greatest(deadline,q.markdown_starts[1]+interval '60 seconds'); end if;
 if q.feedback_until>p_now and q.feedback_remaining=0 then deadline:=greatest(deadline,q.feedback_until); end if;
 return jsonb_build_object('read_starts',to_jsonb(q.read_starts),'burst_starts',to_jsonb(q.burst_starts),'markdown_starts',to_jsonb(q.markdown_starts),'deadline',deadline);
end; $$;

-- Admission and retry reservation share a short transaction; HTTP is never inside it.
-- Sample wall time only after acquiring the singleton lock.
create function public.admit_matter_request(p_slot text,p_key text,p_markdown boolean,p_recover boolean,p_lease jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare q public.matter_quota; w public.matter_request_work; r jsonb; n timestamptz; deadline timestamptz; tries integer; seq bigint; windows jsonb;
begin
 if p_slot is null or p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_markdown is null or p_recover is null then raise exception 'Invalid admission' using errcode='22023'; end if;
 if p_lease is not null then perform public.assert_matter_sync_lease(p_lease->>'p_account_scope',(p_lease->>'p_owner')::uuid,(p_lease->>'p_generation')::bigint);
 elsif p_slot<>'bootstrap' then raise exception 'Preparation requires lease' using errcode='55000'; end if;
 select * into strict w from public.matter_request_work where slot=p_slot for update;
 if p_slot<>'bootstrap' and w.contract is null then raise exception 'Missing preparation' using errcode='PT409'; end if;
 select * into strict q from public.matter_quota where account_scope='matter' for update;
 n:=clock_timestamp(); r:=w.requests->p_key; tries:=coalesce((r->>'attempts')::integer,0);
 if p_recover and (r ? 'protocol' or (r ? 'status' and (r->>'status')::integer not in (403,404))) and (r->>'next_at')::timestamptz<=n then r:=null; tries:=0; end if;
 if r ? 'value' or r ? 'status' or r ? 'protocol' then return jsonb_build_object('admitted',false,'reason','cached','entry',r); end if;
 -- In-flight attempts count even after a process dies. Recovery is deliberate,
 -- never automatic, and cannot erase the page/cycle or its preparation.
 if tries>=3 then
  if p_recover and (r->>'next_at')::timestamptz<=n then tries:=0;
  else return jsonb_build_object('admitted',false,'reason','exhausted','next_at',r->>'next_at'); end if;
 elsif (r->>'next_at')::timestamptz>n then return jsonb_build_object('admitted',false,'reason','retry','next_at',r->>'next_at'); end if;
 if r is null and (select count(*) from jsonb_object_keys(w.requests))>=256 then raise exception 'Preparation request bound' using errcode='22023'; end if;
 windows:=public.evaluate_matter_quota(to_jsonb(q),n,p_markdown);
 q.read_starts:=array(select jsonb_array_elements_text(windows->'read_starts')::timestamptz);
 q.burst_starts:=array(select jsonb_array_elements_text(windows->'burst_starts')::timestamptz);
 q.markdown_starts:=array(select jsonb_array_elements_text(windows->'markdown_starts')::timestamptz);
 deadline:=(windows->>'deadline')::timestamptz;
 if deadline>n then return jsonb_build_object('admitted',false,'reason','quota','next_at',deadline); end if;
 seq:=q.sequence+1;
 update public.matter_quota set read_starts=array_append(q.read_starts,n),burst_starts=array_append(q.burst_starts,n),
  markdown_starts=case when p_markdown then array_append(q.markdown_starts,n) else q.markdown_starts end,sequence=seq,
  feedback_remaining=case when q.feedback_until>n then greatest(q.feedback_remaining-1,0) else null end,
  feedback_until=case when q.feedback_until>n then q.feedback_until else null end where account_scope='matter';
 update public.matter_request_work set requests=jsonb_set(requests,array[p_key],jsonb_build_object('attempts',tries+1,'sequence',seq::text,'next_at',n+interval '15 minutes')) where slot=p_slot;
 return jsonb_build_object('admitted',true,'sequence',seq::text,'attempt',tries+1);
end; $$;

-- Header feedback is account-wide, even if a worker loses its sync lease.
-- It can only restrict capacity. Late responses subtract all later reservations.
create function public.feedback_matter_request(p_sequence bigint,p_limit integer,p_remaining integer,p_reset timestamptz,p_cooldown timestamptz)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare q public.matter_quota; n timestamptz; remaining integer;
begin
 select * into strict q from public.matter_quota where account_scope='matter' for update;
 n:=clock_timestamp();
 if p_sequence is null or p_sequence<1 or p_sequence>q.sequence then raise exception 'Invalid feedback sequence' using errcode='22023'; end if;
 if (p_limit>0 and p_limit<=1000000 or p_remaining>=0 and p_remaining<=120)
 and (p_reset is null or p_reset>n and p_reset<='9999-12-31T23:59:59Z'::timestamptz) then
  if p_remaining is not null and (p_remaining<0 or p_remaining>coalesce(p_limit,120)) then p_remaining:=null; end if;
  remaining:=greatest(coalesce(p_remaining,120)-(q.sequence-p_sequence),0)::integer;
  -- Lower advertised limits are conservative constraints, never increases.
  remaining:=least(remaining,greatest(coalesce(p_limit,120)-cardinality(array(select t from unnest(q.read_starts) t where t>n-interval '60 seconds')),0));
  update public.matter_quota set feedback_remaining=case when q.feedback_until>n then least(q.feedback_remaining,remaining) else remaining end,
   feedback_until=greatest(q.feedback_until,coalesce(p_reset,n+interval '60 seconds')) where account_scope='matter';
 end if;
 if p_cooldown is not null and p_cooldown>n and p_cooldown<='9999-12-31T23:59:59Z'::timestamptz then
  update public.matter_quota set not_before=greatest(not_before,p_cooldown) where account_scope='matter';
 end if;
end; $$;

create function public.finish_matter_request(p_slot text,p_key text,p_sequence bigint,p_entry jsonb,p_lease jsonb)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare w public.matter_request_work; r jsonb; n timestamptz;
begin
 if p_lease is not null then perform public.assert_matter_sync_lease(p_lease->>'p_account_scope',(p_lease->>'p_owner')::uuid,(p_lease->>'p_generation')::bigint);
 elsif p_slot<>'bootstrap' then raise exception 'Preparation requires lease' using errcode='55000'; end if;
 if jsonb_typeof(p_entry) is distinct from 'object' or octet_length(p_entry::text)>4194304
 or exists(select 1 from jsonb_object_keys(p_entry) k where k not in ('value','status','transient_delay_ms','quota','protocol')) then raise exception 'Invalid request outcome' using errcode='22023'; end if;
 select * into strict w from public.matter_request_work where slot=p_slot for update;
 r:=w.requests->p_key; n:=clock_timestamp();
 if r is null or (r->>'sequence')::bigint is distinct from p_sequence then raise exception 'Stale request outcome' using errcode='PT409'; end if;
 if p_entry ? 'transient_delay_ms' then
  if (p_entry->>'transient_delay_ms')::integer not between 0 and 2000 then raise exception 'Invalid retry delay' using errcode='22023'; end if;
  r:=r || jsonb_build_object('next_at',n+case when (r->>'attempts')::integer>=3 then interval '15 minutes' else make_interval(secs=>(p_entry->>'transient_delay_ms')::double precision/1000) end);
 elsif p_entry ? 'quota' then
  -- Quota deferral is distinct from transient failure and retains prior failures.
  r:=r || jsonb_build_object('attempts',greatest((r->>'attempts')::integer-1,0),'next_at',n);
 elsif p_slot='bootstrap' and p_entry ? 'value' then
  update public.matter_request_work set requests=requests-p_key where slot=p_slot; return;
 else r:=r || p_entry;
 end if;
 update public.matter_request_work set requests=jsonb_set(requests,array[p_key],r) where slot=p_slot;
end; $$;

-- Bounded cursor history follows the page commit in the SAME transaction.
-- A loop rolls back all effects, receipt, watermark and history completion.
create function public.track_matter_page_cursors() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare w public.matter_request_work; h text;
begin
 select * into strict w from public.matter_request_work where slot=new.stream for update;
 if old.cycle_active and (new.cursor is distinct from old.cursor or not new.cycle_active) then
  if w.cursor_generation is distinct from new.cycle_generation then w.cursor_hashes:='{}'; end if;
  if old.cursor is not null and not md5(old.cursor)=any(w.cursor_hashes) then w.cursor_hashes:=array_append(w.cursor_hashes,md5(old.cursor)); end if;
  if new.cursor is not null then
   h:=md5(new.cursor);
   if h=any(w.cursor_hashes) then raise exception 'Durable cursor loop' using errcode='22023'; end if;
   if cardinality(w.cursor_hashes)>=10000 then raise exception 'Cursor history bound' using errcode='22023'; end if;
  end if;
  update public.matter_request_work set contract=null,requests='{}',cursor_generation=new.cycle_generation,
   cursor_hashes=case when new.cycle_active then w.cursor_hashes else '{}'::text[] end where slot=new.stream;
 end if;
 return new;
end; $$;
create trigger track_matter_page_cursors after update on public.matter_sync_streams for each row execute function public.track_matter_page_cursors();

revoke all on function public.evaluate_matter_quota(jsonb,timestamptz,boolean),public.prepare_matter_request_work(text,uuid,bigint,jsonb),public.admit_matter_request(text,text,boolean,boolean,jsonb),public.feedback_matter_request(bigint,integer,integer,timestamptz,timestamptz),public.finish_matter_request(text,text,bigint,jsonb,jsonb),public.track_matter_page_cursors() from public,anon,authenticated;
grant execute on function public.evaluate_matter_quota(jsonb,timestamptz,boolean),public.prepare_matter_request_work(text,uuid,bigint,jsonb),public.admit_matter_request(text,text,boolean,boolean,jsonb),public.feedback_matter_request(bigint,integer,integer,timestamptz,timestamptz),public.finish_matter_request(text,text,bigint,jsonb,jsonb),public.track_matter_page_cursors() to service_role;
