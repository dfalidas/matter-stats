-- Task 20. Inactive until repair_prepare is explicitly invoked. No raw backfill.
-- All-time, single-account scope. Drain incompatible application writers before use.
create table public.reading_generation_control (
  singleton boolean primary key default true check (singleton),
  active uuid, previous uuid, building uuid, frozen uuid,
  epoch bigint not null default 0, source_revision bigint not null default 0
);
insert into public.reading_generation_control(singleton) values(true);
create table public.reading_generations (
  id uuid primary key, parent uuid, baseline uuid,
  scope text not null default 'all-stored-sessions' check(scope='all-stored-sessions'),
  timezone text not null, word_method text not null default 'session-duration-225-round-v1',
  calendar_method text not null default 'local-occurrence-day-v1',
  state text not null check(state in ('capture_sessions','capture_days','catchup','verify_sessions','verify_days','ready','live','retained','blocked','cancelled','noop')),
  owner uuid not null, fence bigint not null default 1, expires_at timestamptz not null,
  session_cursor text, day_cursor date, verify_cursor text, verify_day_cursor date,
  captured_sessions bigint not null default 0, captured_days bigint not null default 0,
  checked_sessions bigint not null default 0, checked_days bigint not null default 0,
  staged_sessions bigint not null default 0, verify_attempt bigint not null default 0,
  refresh_original_days boolean not null default false,
  invalid_rows bigint not null default 0, mismatches bigint not null default 0, active_differences bigint not null default 0,
  source_identity uuid not null default gen_random_uuid(), captured_revision bigint not null,
  verification_revision bigint, reconciled_revision bigint, reconciled_epoch bigint, cutover_epoch bigint, rollback_epoch bigint,
  created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
  reconciliation jsonb
);
create table public.reading_repair_source (
  generation uuid not null references public.reading_generations(id),
  kind text not null check(kind in ('session','daily')), key text not null, row_data jsonb not null,
  invalid_reasons text[] not null default '{}', primary key(generation,kind,key)
);
create table public.reading_generation_sessions (
  generation uuid not null references public.reading_generations(id), id text not null,
  date date not null, duration_seconds bigint not null check(duration_seconds between 0 and 9007199254740991),
  words_estimated bigint, word_estimation_method text,
  canonical_words bigint not null check(canonical_words between 0 and 9007199254740991),
  primary key(generation,id)
);
create index reading_generation_sessions_day on public.reading_generation_sessions(generation,date);
create table public.reading_generation_days (
  generation uuid not null references public.reading_generations(id), date date not null,
  reading_time_seconds bigint not null default 0 check(reading_time_seconds between 0 and 9007199254740991),
  words_read bigint not null default 0 check(words_read between 0 and 9007199254740991), sessions_count bigint not null default 0 check(sessions_count between 0 and 9007199254740991),
  original_reading jsonb, preserve_original boolean not null default false,
  primary key(generation,date)
);
create table public.reading_repair_changes (
  generation uuid not null references public.reading_generations(id), id text not null,
  row_data jsonb, revision bigint not null, primary key(generation,id)
);
create table public.reading_repair_check_days (
  generation uuid not null references public.reading_generations(id), attempt bigint not null, date date not null,
  seconds bigint not null default 0, words bigint not null default 0, sessions bigint not null default 0,
  primary key(generation,attempt,date)
);

create function public.repair_words(p_seconds bigint) returns bigint
language sql immutable strict security invoker set search_path='' as $$
  select (floor(x) + case when x-floor(x)>=0.5::double precision then 1 else 0 end)::bigint
  from (select (p_seconds::double precision / 60::double precision) * 225::double precision x) v;
$$;
create function public.repair_invalid(p_row jsonb) returns text[]
language plpgsql stable security invoker set search_path='' as $$
declare reasons text[] := '{}'; seconds bigint; stamp timestamptz;
begin
  if p_row->>'id' is null or btrim(p_row->>'id')='' then reasons:=array_append(reasons,'invalid_id'); end if;
  begin
    seconds:=(p_row->>'duration_seconds')::bigint;
    if seconds is null or seconds<0 then reasons:=array_append(reasons,'invalid_duration'); end if;
  exception when others then reasons:=array_append(reasons,'invalid_duration'); end;
  begin
    stamp:=(p_row->>'started_at')::timestamptz;
    if stamp is null or not isfinite(stamp) or extract(year from stamp) not between 1 and 9999 then
      reasons:=array_append(reasons,'invalid_timestamp');
    end if;
  exception when others then reasons:=array_append(reasons,'invalid_timestamp'); end;
  return reasons;
end;
$$;
-- Replace an id's contribution, never add it twice. Includes zero duration.
create function public.repair_replace_session(p_gen uuid,p_id text,p_row jsonb,p_original boolean default false)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare oldrow public.reading_generation_sessions; g public.reading_generations; day date; seconds bigint; words bigint;
begin
  select * into g from public.reading_generations where id=p_gen;
  select * into oldrow from public.reading_generation_sessions where generation=p_gen and id=p_id;
  if found then
    update public.reading_generation_days set reading_time_seconds=reading_time_seconds-oldrow.duration_seconds,
      words_read=words_read-oldrow.canonical_words,sessions_count=sessions_count-1,
      preserve_original=case when p_original then preserve_original else false end
      where generation=p_gen and date=oldrow.date;
    delete from public.reading_generation_sessions where generation=p_gen and id=p_id;
    update public.reading_generations set staged_sessions=staged_sessions-1 where id=p_gen;
  end if;
  if p_row is null then return; end if;
  if cardinality(public.repair_invalid(p_row))>0 then raise exception 'Invalid required repair input' using errcode='22023'; end if;
  seconds:=(p_row->>'duration_seconds')::bigint; words:=public.repair_words(seconds);
  day:=((p_row->>'started_at')::timestamptz at time zone g.timezone)::date;
  insert into public.reading_generation_sessions(generation,id,date,duration_seconds,words_estimated,word_estimation_method,canonical_words)
    values(p_gen,p_id,day,seconds,case when p_original then (p_row->>'words_estimated')::bigint else words end,
      case when p_original then p_row->>'word_estimation_method' else g.word_method end,words);
  update public.reading_generations set staged_sessions=staged_sessions+1 where id=p_gen;
  insert into public.reading_generation_days(generation,date,reading_time_seconds,words_read,sessions_count,preserve_original)
    values(p_gen,day,seconds,words,1,p_original)
    on conflict(generation,date) do update set
      reading_time_seconds=public.reading_generation_days.reading_time_seconds+excluded.reading_time_seconds,
      words_read=public.reading_generation_days.words_read+excluded.words_read,
      sessions_count=public.reading_generation_days.sessions_count+1,
      preserve_original=case when p_original then public.reading_generation_days.preserve_original else false end;
end;
$$;
-- Deterministic fencing errors use 55000, never 40001: Data API transaction
-- adapters may automatically retry serialization failures indefinitely.
-- Statement-level mutex is taken BEFORE raw row locks. Same mutex for repair/cutover.
create function public.repair_source_guard() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare c public.reading_generation_control;
begin
  select * into c from public.reading_generation_control where singleton for update;
  if c.frozen is not null then raise exception 'Historical capture/reconciliation barrier: retry later' using errcode='55000'; end if;
  if tg_op='TRUNCATE' and (c.active is not null or c.building is not null) then
    raise exception 'TRUNCATE incompatible with reading generations' using errcode='55000';
  end if;
  return null;
end;
$$;
create trigger repair_sessions_guard before insert or update or delete or truncate on public.reading_sessions
  for each statement execute function public.repair_source_guard();
create trigger repair_days_guard before insert or update or delete or truncate on public.daily_stats
  for each statement execute function public.repair_source_guard();
create function public.repair_source_changed() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare c public.reading_generation_control; row_data jsonb; ident text; gid uuid;
begin
  select * into c from public.reading_generation_control where singleton;
  if tg_table_name='reading_sessions' then
    if tg_op='UPDATE' and new.id is distinct from old.id then raise exception 'Session identity is immutable' using errcode='22023'; end if;
    ident:=case when tg_op='DELETE' then old.id else new.id end;
    row_data:=case when tg_op='DELETE' then null else to_jsonb(new) end;
    -- Only the selected active/rollback pair is maintained; older history is retained.
    for gid in select distinct x from unnest(array[c.active,c.previous]) x where x is not null loop
      perform public.repair_replace_session(gid,ident,row_data);
      -- An unknown old calendar cannot identify all obsolete buckets. Conservatively
      -- reconcile ALL baseline reading dates after any source mutation, via one flag.
      update public.reading_generations set refresh_original_days=true where id=gid and parent is null;
    end loop;
    update public.reading_generation_control set source_revision=source_revision+1 where singleton returning * into c;
    if c.building is not null then
      insert into public.reading_repair_changes(generation,id,row_data,revision) values(c.building,ident,row_data,c.source_revision)
        on conflict(generation,id) do update set row_data=excluded.row_data,revision=excluded.revision;
      update public.reading_generations set reconciled_revision=null,state=case when state='ready' then 'catchup' else state end where id=c.building;
    end if;
  elsif tg_table_name='daily_stats' then
    update public.reading_generation_control set source_revision=source_revision+1 where singleton returning * into c;
    if c.building is not null then
      update public.reading_generations set reconciled_revision=null,state=case when state='ready' then 'catchup' else state end where id=c.building;
    end if;
    -- Reading shadow totals come from session contributions. Daily writers keep metadata,
    -- dirty revision/ack semantics and cannot overwrite active reading aggregates.
    for gid in select distinct x from unnest(array[c.active,c.previous]) x where x is not null loop
      update public.reading_generation_days set preserve_original=false where generation=gid
        and date=case when tg_op='DELETE' then old.date else new.date end;
    end loop;
  end if;
  return null;
end;
$$;
create trigger repair_sessions_changed after insert or update or delete on public.reading_sessions
  for each row execute function public.repair_source_changed();
create trigger repair_days_changed after insert or update or delete on public.daily_stats
  for each row execute function public.repair_source_changed();

create function public.repair_prepare(p_id uuid,p_owner uuid,p_expected_active uuid,p_expected_epoch bigint,p_timezone text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare c public.reading_generation_control; base uuid;
begin
  if p_id is null or p_owner is null or p_expected_epoch is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'Explicit valid repair contract required' using errcode='22023'; end if;
  select * into c from public.reading_generation_control where singleton for update;
  if c.active is distinct from p_expected_active or c.epoch<>p_expected_epoch or c.building is not null then
    raise exception 'Conflicting repair operator or generation' using errcode='55000'; end if;
  base:=case when c.active is null then gen_random_uuid() else c.active end;
  if c.active is null then
    insert into public.reading_generations(id,timezone,state,owner,expires_at,captured_revision)
      values(base,p_timezone,'capture_sessions',p_owner,clock_timestamp()+interval '120 seconds',c.source_revision);
  end if;
  insert into public.reading_generations(id,parent,baseline,timezone,state,owner,expires_at,captured_revision)
    values(p_id,c.active,base,p_timezone,'capture_sessions',p_owner,clock_timestamp()+interval '120 seconds',c.source_revision);
  update public.reading_generation_control set building=p_id,frozen=p_id where singleton;
  return (select to_jsonb(g) from public.reading_generations g where id=p_id);
end;
$$;
create function public.repair_claim(p_id uuid,p_owner uuid,p_expected_fence bigint)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare g public.reading_generations;
begin
  perform 1 from public.reading_generation_control where singleton for update;
  select * into g from public.reading_generations where id=p_id for update;
  if not found or p_owner is null or p_expected_fence is null or g.fence<>p_expected_fence then
    raise exception 'Stale repair fence' using errcode='55000'; end if;
  if g.owner<>p_owner and g.expires_at>clock_timestamp() then raise exception 'Repair worker busy' using errcode='55P03'; end if;
  update public.reading_generations set owner=p_owner,fence=fence+1,expires_at=clock_timestamp()+interval '120 seconds'
    where id=p_id returning * into g;
  return to_jsonb(g);
end;
$$;
create function public.repair_assert(p_id uuid,p_owner uuid,p_fence bigint) returns public.reading_generations
language plpgsql volatile security invoker set search_path='' as $$
declare g public.reading_generations;
begin
  perform 1 from public.reading_generation_control where singleton for update;
  select * into g from public.reading_generations where id=p_id for update;
  if not found or p_owner is null or p_fence is null or g.owner<>p_owner or g.fence<>p_fence or g.expires_at<=clock_timestamp() then
    raise exception 'Stale or expired repair owner' using errcode='55000'; end if;
  update public.reading_generations set expires_at=clock_timestamp()+interval '120 seconds' where id=p_id;
  return g;
end;
$$;

-- Each invocation processes at most 500 rows and 1,000 ms of loop work.
-- Caller additionally sets statement_timeout/lock_timeout on its short transaction.
create function public.repair_batch(p_id uuid,p_owner uuid,p_fence bigint,p_rows integer,p_milliseconds integer)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare g public.reading_generations; c public.reading_generation_control; r record; n integer:=0;
  until_time timestamptz; reasons text[]; words bigint; day date; existing public.reading_generation_sessions;
  actual public.reading_generation_days; chk public.reading_repair_check_days; diff bigint;
begin
  if p_rows is null or p_rows not between 1 and 500 or p_milliseconds is null or p_milliseconds not between 1 and 1000 then
    raise exception 'Invalid repair batch budget' using errcode='22023'; end if;
  g:=public.repair_assert(p_id,p_owner,p_fence);
  select * into c from public.reading_generation_control where singleton;
  if c.building is distinct from p_id then raise exception 'Repair no longer selected' using errcode='55000'; end if;
  if g.state in ('capture_sessions','capture_days','verify_sessions','verify_days') and c.frozen is distinct from p_id then
    raise exception 'Source barrier lost; cancel and restart, never combine captures' using errcode='55000'; end if;
  if g.state in ('capture_sessions','capture_days') and c.source_revision<>g.captured_revision then
    raise exception 'Captured source changed; cancel and restart' using errcode='55000'; end if;
  if g.state in ('verify_sessions','verify_days') and c.source_revision is distinct from g.verification_revision then
    raise exception 'Verification source changed; cancel and restart' using errcode='55000'; end if;
  until_time:=clock_timestamp()+p_milliseconds*interval '1 millisecond';
  if g.state='capture_sessions' then
    for r in select s.id,
      to_jsonb(s) || case when g.parent is null then '{}'::jsonb else
        jsonb_build_object('words_estimated',b.words_estimated,'word_estimation_method',b.word_estimation_method) end data,
      b.id baseline_id from public.reading_sessions s left join public.reading_generation_sessions b on b.generation=g.parent and b.id=s.id
      where g.session_cursor is null or s.id>g.session_cursor order by s.id limit p_rows loop
      if g.parent is not null and r.baseline_id is null then raise exception 'Selected old generation input unavailable' using errcode='55000'; end if;
      reasons:=public.repair_invalid(r.data);
      insert into public.reading_repair_source(generation,kind,key,row_data,invalid_reasons) values(p_id,'session',r.id,r.data,reasons);
      if cardinality(reasons)=0 then
        perform public.repair_replace_session(p_id,r.id,r.data);
        if g.parent is null then perform public.repair_replace_session(g.baseline,r.id,r.data,true); end if;
      else g.invalid_rows:=g.invalid_rows+1; end if;
      g.session_cursor:=r.id; g.captured_sessions:=g.captured_sessions+1; n:=n+1;
      exit when clock_timestamp()>=until_time;
    end loop;
    if n=0 then g.state:='capture_days'; end if;
  elsif g.state='capture_days' then
    for r in
      select s.date,to_jsonb(s) data from public.daily_stats s
        where g.parent is null and (g.day_cursor is null or s.date>g.day_cursor)
      union all
      select (v->>'date')::date date,v data from jsonb_array_elements(case when g.parent is null then '[]'::jsonb
        else public.read_generation_days(g.parent,g.day_cursor,null,p_rows) end) v
      order by date limit p_rows loop
      reasons:='{}';
      if r.data->'reading_provenance'->>'calendarMethod'='local-occurrence-day-v1' and not exists
        (select 1 from pg_catalog.pg_timezone_names where name=r.data->'reading_provenance'->>'timezone') then
        reasons:=array['invalid_provenance_timezone']; g.invalid_rows:=g.invalid_rows+1;
      end if;
      insert into public.reading_repair_source(generation,kind,key,row_data,invalid_reasons) values(p_id,'daily',r.date::text,r.data,reasons);
      insert into public.reading_generation_days(generation,date) values(p_id,r.date) on conflict do nothing;
      if g.parent is null then
        insert into public.reading_generation_days(generation,date,original_reading,preserve_original)
          values(g.baseline,r.date,r.data,true) on conflict(generation,date) do update set original_reading=excluded.original_reading,preserve_original=true;
      end if;
      g.day_cursor:=r.date; g.captured_days:=g.captured_days+1; n:=n+1;
      exit when clock_timestamp()>=until_time;
    end loop;
    if n=0 then
      g.state:=case when g.invalid_rows>0 then 'blocked' else 'catchup' end;
      update public.reading_generation_control set frozen=null,
        active=case when g.parent is null and g.invalid_rows=0 then g.baseline else active end
        where singleton;
      if g.parent is null then
        update public.reading_generations set state=case when g.invalid_rows>0 then 'blocked' else 'live' end where id=g.baseline;
        -- Baseline activation does not change values. Parent pins the rollback target.
        g.parent:=g.baseline;
      end if;
    end if;
  elsif g.state='catchup' then
    for r in select * from public.reading_repair_changes where generation=p_id order by id limit p_rows loop
      reasons:=case when r.row_data is null then '{}'::text[] else public.repair_invalid(r.row_data) end;
      if cardinality(reasons)>0 then
        g.invalid_rows:=g.invalid_rows+1; g.state:='blocked'; exit;
      end if;
      perform public.repair_replace_session(p_id,r.id,r.row_data);
      delete from public.reading_repair_changes where generation=p_id and id=r.id and revision=r.revision;
      n:=n+1; exit when clock_timestamp()>=until_time;
    end loop;
  elsif g.state='verify_sessions' then
    for r in select s.id,to_jsonb(s) data from public.reading_sessions s
      where g.verify_cursor is null or s.id>g.verify_cursor order by s.id limit p_rows loop
      reasons:=public.repair_invalid(r.data);
      if cardinality(reasons)>0 then g.invalid_rows:=g.invalid_rows+1;
      else
        day:=((r.data->>'started_at')::timestamptz at time zone g.timezone)::date;
        words:=public.repair_words((r.data->>'duration_seconds')::bigint);
        select * into existing from public.reading_generation_sessions where generation=p_id and id=r.id;
        if not found or existing.date<>day or existing.duration_seconds<>(r.data->>'duration_seconds')::bigint
          or existing.words_estimated is distinct from words or existing.word_estimation_method is distinct from g.word_method then
          g.mismatches:=g.mismatches+1; end if;
        select * into existing from public.reading_generation_sessions where generation=c.active and id=r.id;
        if not found or existing.date<>day or existing.duration_seconds<>(r.data->>'duration_seconds')::bigint
          or existing.words_estimated is distinct from words or existing.word_estimation_method is distinct from g.word_method then
          g.active_differences:=g.active_differences+1; end if;
        insert into public.reading_repair_check_days(generation,attempt,date,seconds,words,sessions)
          values(p_id,g.verify_attempt,day,(r.data->>'duration_seconds')::bigint,words,1)
          on conflict(generation,attempt,date) do update set seconds=public.reading_repair_check_days.seconds+excluded.seconds,
            words=public.reading_repair_check_days.words+excluded.words,sessions=public.reading_repair_check_days.sessions+1;
      end if;
      g.verify_cursor:=r.id; g.checked_sessions:=g.checked_sessions+1; n:=n+1;
      exit when clock_timestamp()>=until_time;
    end loop;
    if n=0 then
      -- Generation-only ids (e.g. missed deletion) also fail, not just missing raw ids.
      if (select staged_sessions from public.reading_generations where id=p_id)<>g.checked_sessions then g.mismatches:=g.mismatches+1; end if;
      g.state:='verify_days';
    end if;
  elsif g.state='verify_days' then
    for r in select date from (
      select date from public.reading_generation_days where generation=p_id
      union select date from public.reading_repair_check_days where generation=p_id and attempt=g.verify_attempt
      union select date from public.daily_stats
    ) dates where g.verify_day_cursor is null or date>g.verify_day_cursor order by date limit p_rows loop
      select * into actual from public.reading_generation_days where generation=p_id and date=r.date;
      select * into chk from public.reading_repair_check_days where generation=p_id and attempt=g.verify_attempt and date=r.date;
      if coalesce(actual.reading_time_seconds,0)<>coalesce(chk.seconds,0) or coalesce(actual.words_read,0)<>coalesce(chk.words,0)
        or coalesce(actual.sessions_count,0)<>coalesce(chk.sessions,0) then g.mismatches:=g.mismatches+1; end if;
      select * into actual from public.reading_generation_days where generation=c.active and date=r.date;
      if actual.preserve_original and not coalesce((select refresh_original_days from public.reading_generations where id=c.active),false) then
        if (actual.original_reading->>'reading_time_seconds')::bigint is distinct from coalesce(chk.seconds,0)
          or (actual.original_reading->>'words_read')::bigint is distinct from coalesce(chk.words,0)
          or (actual.original_reading->>'sessions_count')::bigint is distinct from coalesce(chk.sessions,0)
          or actual.original_reading->'reading_provenance' is distinct from jsonb_build_object('wordMethod',g.word_method,'calendarMethod',g.calendar_method,'timezone',g.timezone) then
          g.active_differences:=g.active_differences+1; end if;
      elsif coalesce(actual.reading_time_seconds,0)<>coalesce(chk.seconds,0) or coalesce(actual.words_read,0)<>coalesce(chk.words,0)
        or coalesce(actual.sessions_count,0)<>coalesce(chk.sessions,0) then g.active_differences:=g.active_differences+1; end if;
      g.verify_day_cursor:=r.date;g.checked_days:=g.checked_days+1;n:=n+1;
      exit when clock_timestamp()>=until_time;
    end loop;
    if n=0 then
      g.state:=case when g.invalid_rows>0 or g.mismatches>0 then 'blocked' else 'ready' end;
      g.reconciled_revision:=c.source_revision;g.reconciled_epoch:=c.epoch;
      g.reconciliation:=jsonb_build_object('sourceIdentity',g.source_identity,'checkedSessions',g.checked_sessions,'checkedDays',g.checked_days,
        'invalidRows',g.invalid_rows,'mismatches',g.mismatches,'activeDifferences',g.active_differences,'revision',c.source_revision,'epoch',c.epoch);
      g.completed_at:=clock_timestamp();
      update public.reading_generation_control set frozen=null where singleton;
    end if;
  elsif g.state not in ('ready','blocked') then raise exception 'Invalid batch lifecycle' using errcode='55000';
  end if;
  update public.reading_generations set state=g.state,parent=g.parent,session_cursor=g.session_cursor,day_cursor=g.day_cursor,
    verify_cursor=g.verify_cursor,verify_day_cursor=g.verify_day_cursor,captured_sessions=g.captured_sessions,captured_days=g.captured_days,
    checked_sessions=g.checked_sessions,checked_days=g.checked_days,invalid_rows=g.invalid_rows,mismatches=g.mismatches,
    active_differences=g.active_differences,reconciled_revision=g.reconciled_revision,reconciled_epoch=g.reconciled_epoch,
    reconciliation=g.reconciliation,completed_at=g.completed_at where id=p_id;
  return jsonb_build_object('processed',n,'run',(select to_jsonb(v) from public.reading_generations v where id=p_id));
end;
$$;
create function public.repair_reconcile(p_id uuid,p_owner uuid,p_fence bigint) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare g public.reading_generations; c public.reading_generation_control;
begin
  g:=public.repair_assert(p_id,p_owner,p_fence);
  select * into c from public.reading_generation_control where singleton;
  if c.building is distinct from p_id or g.state not in ('catchup','ready')
    or exists(select 1 from public.reading_repair_changes where generation=p_id) then
    raise exception 'Catch-up incomplete; resume before reconciliation' using errcode='55000'; end if;
  -- A completed verification becomes stale on ANY source revision; reverify explicitly.
  update public.reading_generations set state='verify_sessions',verify_attempt=verify_attempt+1,verify_cursor=null,verify_day_cursor=null,
    checked_sessions=0,checked_days=0,mismatches=0,active_differences=0,verification_revision=c.source_revision,reconciled_revision=null,reconciliation=null where id=p_id;
  update public.reading_generation_control set frozen=p_id where singleton;
  return (select to_jsonb(v) from public.reading_generations v where id=p_id);
end;
$$;
create function public.repair_transition(p_id uuid,p_owner uuid,p_fence bigint,p_expected_active uuid,p_expected_epoch bigint,p_rollback boolean)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare g public.reading_generations; c public.reading_generation_control; target uuid;
begin
  if p_expected_epoch is null or p_rollback is null then raise exception 'Explicit transition contract required' using errcode='22023'; end if;
  g:=public.repair_assert(p_id,p_owner,p_fence);
  select * into c from public.reading_generation_control where singleton;
  -- Idempotent only at the epoch produced by this operation, never across later switches.
  if p_rollback and g.rollback_epoch=c.epoch and c.active=g.parent then return to_jsonb(c); end if;
  if not p_rollback and g.cutover_epoch=c.epoch and c.active=p_id then return to_jsonb(c); end if;
  if not p_rollback and g.state='noop' and c.active=g.parent and c.epoch=g.reconciled_epoch then return to_jsonb(c); end if;
  if c.active is distinct from p_expected_active or c.epoch<>p_expected_epoch or c.frozen is not null then
    raise exception 'Conflicting or stale transition' using errcode='55000'; end if;
  if p_rollback then
    if c.active<>p_id or c.previous is distinct from g.parent or c.building is not null
      or not exists(select 1 from public.reading_generations where id=g.parent and state='retained'
        and staged_sessions=(select staged_sessions from public.reading_generations where id=p_id)) then
      raise exception 'Rollback target unavailable or no longer maintained' using errcode='55000'; end if;
    target:=g.parent;
    update public.reading_generations set rollback_epoch=c.epoch+1 where id=p_id;
  else
    if g.state<>'ready' or g.invalid_rows<>0 or g.mismatches<>0 or g.reconciled_revision is distinct from c.source_revision
      or g.reconciled_epoch is distinct from c.epoch or c.building is distinct from p_id
      or exists(select 1 from public.reading_repair_changes where generation=p_id) then
      raise exception 'Generation not complete and reconciled at current source' using errcode='55000'; end if;
    if g.active_differences=0 and (select timezone from public.reading_generations where id=c.active)=g.timezone then
      update public.reading_generations set state='noop' where id=p_id;
      update public.reading_generation_control set building=null where singleton returning * into c;
      return to_jsonb(c);
    end if;
    target:=p_id;
    update public.reading_generations set cutover_epoch=c.epoch+1 where id=p_id;
  end if;
  update public.reading_generations set state='retained' where id=c.active;
  update public.reading_generations set state='live' where id=target;
  update public.reading_generation_control set active=target,previous=c.active,building=null,epoch=epoch+1 where singleton returning * into c;
  return to_jsonb(c);
end;
$$;
create function public.repair_cancel(p_id uuid,p_owner uuid,p_fence bigint) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare g public.reading_generations;
begin
  g:=public.repair_assert(p_id,p_owner,p_fence);
  if not exists(select 1 from public.reading_generation_control where singleton and building=p_id) then
    raise exception 'Cannot cancel an active or unrelated generation' using errcode='55000'; end if;
  update public.reading_generations set state='cancelled' where id=p_id;
  update public.reading_generation_control set building=null,frozen=null where singleton;
  return (select to_jsonb(c) from public.reading_generation_control c where singleton);
end;
$$;
-- Explicit captured generation; never look up the pointer inside a paged read.
create function public.read_generation_days(p_generation uuid,p_after date,p_since date,p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; g public.reading_generations;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid read bound' using errcode='22023'; end if;
  if p_generation is not null then
    select * into g from public.reading_generations where id=p_generation;
    if not found or g.state not in ('live','retained') then raise exception 'Incomplete reading generation' using errcode='55000'; end if;
  end if;
  select coalesce(jsonb_agg(row_data order by date),'[]'::jsonb) into result from (
    select dates.date,
      coalesce(to_jsonb(d),jsonb_build_object('date',dates.date,'items_read_count',0,'highlights_count',0,'top_source',null,'created_at',g.created_at,'updated_at',g.completed_at))
      || case when p_generation is null then '{}'::jsonb
        when v.preserve_original and not g.refresh_original_days and v.original_reading is not null then
          jsonb_build_object('reading_time_seconds',v.original_reading->'reading_time_seconds','words_read',v.original_reading->'words_read',
            'sessions_count',v.original_reading->'sessions_count','reading_provenance',v.original_reading->'reading_provenance')
        else jsonb_build_object('reading_time_seconds',coalesce(v.reading_time_seconds,0),'words_read',coalesce(v.words_read,0),
          'sessions_count',coalesce(v.sessions_count,0),'reading_provenance',jsonb_build_object('wordMethod',g.word_method,'calendarMethod',g.calendar_method,'timezone',g.timezone)) end row_data
    from (
      select date from (select date from public.daily_stats union select date from public.reading_generation_days
        where generation=p_generation and (not preserve_original or original_reading is not null or g.refresh_original_days)) all_dates
      where (p_after is null or date>p_after) and (p_since is null or date>=p_since) order by date limit p_limit
    ) dates left join public.daily_stats d using(date)
      left join public.reading_generation_days v on v.generation=p_generation and v.date=dates.date
  ) rows;
  return result;
end;
$$;
create function public.read_generation_estimates(p_generation uuid,p_ids text[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_ids is null or cardinality(p_ids)>100 then raise exception 'Invalid estimate read bound' using errcode='22023'; end if;
  if p_generation is null then return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'words_estimated',words_estimated,'word_estimation_method',word_estimation_method)),'[]') from public.reading_sessions where id=any(p_ids)); end if;
  if not exists(select 1 from public.reading_generations where id=p_generation and state in ('live','retained')) then raise exception 'Incomplete reading generation' using errcode='55000'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'words_estimated',words_estimated,'word_estimation_method',word_estimation_method)),'[]') from public.reading_generation_sessions where generation=p_generation and id=any(p_ids));
end;
$$;

alter table public.reading_generation_control enable row level security;
alter table public.reading_generations enable row level security;
alter table public.reading_repair_source enable row level security;
alter table public.reading_generation_sessions enable row level security;
alter table public.reading_generation_days enable row level security;
alter table public.reading_repair_changes enable row level security;
alter table public.reading_repair_check_days enable row level security;
revoke all on public.reading_generation_control,public.reading_generations,public.reading_repair_source,public.reading_generation_sessions,
  public.reading_generation_days,public.reading_repair_changes,public.reading_repair_check_days from public,anon,authenticated,service_role;
grant select,update on public.reading_generation_control to service_role;
grant select,insert on public.reading_repair_source to service_role;
grant select,insert,update,delete on public.reading_generations,public.reading_generation_sessions,public.reading_generation_days,
  public.reading_repair_changes,public.reading_repair_check_days to service_role;
revoke all on function public.repair_words(bigint),public.repair_invalid(jsonb),public.repair_replace_session(uuid,text,jsonb,boolean),
  public.repair_source_guard(),public.repair_source_changed(),public.repair_prepare(uuid,uuid,uuid,bigint,text),public.repair_claim(uuid,uuid,bigint),
  public.repair_assert(uuid,uuid,bigint),public.repair_batch(uuid,uuid,bigint,integer,integer),public.repair_reconcile(uuid,uuid,bigint),
  public.repair_transition(uuid,uuid,bigint,uuid,bigint,boolean),public.repair_cancel(uuid,uuid,bigint),
  public.read_generation_days(uuid,date,date,integer),public.read_generation_estimates(uuid,text[]) from public,anon,authenticated;
grant execute on function public.repair_words(bigint),public.repair_invalid(jsonb),public.repair_replace_session(uuid,text,jsonb,boolean),
  public.repair_source_guard(),public.repair_source_changed(),public.repair_prepare(uuid,uuid,uuid,bigint,text),public.repair_claim(uuid,uuid,bigint),
  public.repair_assert(uuid,uuid,bigint),public.repair_batch(uuid,uuid,bigint,integer,integer),public.repair_reconcile(uuid,uuid,bigint),
  public.repair_transition(uuid,uuid,bigint,uuid,bigint,boolean),public.repair_cancel(uuid,uuid,bigint),
  public.read_generation_days(uuid,date,date,integer),public.read_generation_estimates(uuid,text[]) to service_role;
