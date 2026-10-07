-- Task 14. Additive intent/scheduling; preserves streams, receipts and dirty work.
create table public.matter_sync_continuation (
  account_scope text primary key check (account_scope = 'matter'),
  coverage text not null default 'all' check (coverage = 'all'),
  history_status text not null default 'none' check (history_status in ('none','pending','running','complete')),
  requested_at timestamptz,
  history_cycle_generation bigint,
  completed_at timestamptz,
  next_stream text not null default 'library_items' check (next_stream in ('recent_sessions','library_items')),
  constraint history_intent_contract check (
    (history_status='none' and requested_at is null and history_cycle_generation is null and completed_at is null) or
    (history_status='pending' and requested_at is not null and history_cycle_generation is null and completed_at is null) or
    (history_status='running' and requested_at is not null and history_cycle_generation is not null and history_cycle_generation>0 and completed_at is null) or
    (history_status='complete' and requested_at is not null and history_cycle_generation is not null and history_cycle_generation>0 and completed_at is not null)
  )
);
alter table public.matter_sync_continuation enable row level security;
revoke all on public.matter_sync_continuation from public, anon, authenticated, service_role;
grant select, update on public.matter_sync_continuation to service_role;
insert into public.matter_sync_continuation(account_scope) values ('matter');
comment on table public.matter_sync_continuation is 'Explicit full available-session enumeration and fair continuation turn. Never inferred from incremental watermarks. No retention/completeness guarantee.';

create function public.request_matter_history(p_account_scope text,p_owner uuid,p_generation bigint,p_coverage text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare intent public.matter_sync_continuation;
begin
  perform public.assert_matter_sync_lease(p_account_scope,p_owner,p_generation);
  if p_coverage is distinct from 'all' then raise exception 'Unsupported history coverage' using errcode='22023'; end if;
  select * into strict intent from public.matter_sync_continuation where account_scope=p_account_scope for update;
  if intent.history_status='none' then
    update public.matter_sync_continuation set history_status='pending',requested_at=clock_timestamp(),next_stream='recent_sessions'
      where account_scope=p_account_scope returning * into intent;
  end if;
  return to_jsonb(intent); -- matching pending/running/completed requests are idempotent
end;
$$;

create function public.begin_matter_history(p_account_scope text,p_owner uuid,p_generation bigint,p_limit integer,p_started_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare intent public.matter_sync_continuation; state public.matter_sync_streams;
begin
  perform public.assert_matter_sync_lease(p_account_scope,p_owner,p_generation);
  if p_limit is null or p_limit not between 1 and 100 or p_started_at is null then raise exception 'Invalid history contract' using errcode='22023'; end if;
  select * into strict intent from public.matter_sync_continuation where account_scope=p_account_scope for update;
  select * into strict state from public.matter_sync_streams where stream='recent_sessions' for update;
  -- Queue behind an existing cycle without changing ANY of its request contract.
  if intent.history_status='pending' and not state.cycle_active then
    update public.matter_sync_streams set endpoint='/reading_sessions',filters='{}'::jsonb,
      page_limit=p_limit,cursor=null,cycle_started_at=p_started_at,cycle_generation=cycle_generation+1,
      cycle_active=true,coverage_window='all',transition_status='native'
      where stream='recent_sessions' returning * into state;
    update public.matter_sync_continuation set history_status='running',history_cycle_generation=state.cycle_generation
      where account_scope=p_account_scope;
  end if;
  return to_jsonb(state);
end;
$$;

create function public.turn_matter_continuation(p_account_scope text,p_owner uuid,p_generation bigint,p_stream text)
returns void language plpgsql volatile security invoker set search_path='' as $$
begin
  perform public.assert_matter_sync_lease(p_account_scope,p_owner,p_generation);
  if p_stream is null or p_stream not in ('recent_sessions','library_items') then raise exception 'Invalid continuation stream' using errcode='22023'; end if;
  update public.matter_sync_continuation set next_stream=case when p_stream='recent_sessions' then 'library_items' else 'recent_sessions' end
    where account_scope=p_account_scope;
end;
$$;

-- Completion belongs to the SAME page transaction, including Task 13 receipt replay.
-- Cooperating older Task 13 writers also complete a bound enumeration atomically.
create function public.complete_matter_history() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
begin
  if new.stream='recent_sessions' and old.cycle_active and not new.cycle_active then
    update public.matter_sync_continuation set history_status='complete',completed_at=new.completed_watermark
      where account_scope='matter' and history_status='running' and history_cycle_generation=new.cycle_generation;
  end if;
  return new;
end;
$$;
create trigger complete_matter_history after update on public.matter_sync_streams
for each row execute function public.complete_matter_history();
revoke all on function public.request_matter_history(text,uuid,bigint,text),public.begin_matter_history(text,uuid,bigint,integer,timestamptz),public.turn_matter_continuation(text,uuid,bigint,text),public.complete_matter_history() from public,anon,authenticated;
grant execute on function public.request_matter_history(text,uuid,bigint,text),public.begin_matter_history(text,uuid,bigint,integer,timestamptz),public.turn_matter_continuation(text,uuid,bigint,text),public.complete_matter_history() to service_role;

-- Account cooldown updates current durable rows, never a client-assumed cursor.
create function public.cooldown_matter_account(p_account_scope text,p_owner uuid,p_generation bigint,p_retry_at timestamptz)
returns void language plpgsql volatile security invoker set search_path='' as $$
begin
  perform public.assert_matter_sync_lease(p_account_scope,p_owner,p_generation);
  if p_retry_at is null then raise exception 'Missing cooldown' using errcode='22023'; end if;
  update public.matter_sync_streams set retry_at=greatest(retry_at,p_retry_at);
end;
$$;
revoke all on function public.cooldown_matter_account(text,uuid,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.cooldown_matter_account(text,uuid,bigint,timestamptz) to service_role;
