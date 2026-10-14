-- Task 19: no historical UPDATE, defaults, repair state, or new public API.
-- Disable/drain old writers; apply after Task 15, then deploy compatible code.
alter table public.reading_sessions add column word_estimation_method text;
alter table public.daily_stats add column reading_provenance jsonb;
comment on column public.reading_sessions.word_estimation_method is 'NULL = legacy/unknown, even when value equals canonical. Explicit calculation provenance, not inferred from equality.';
comment on column public.daily_stats.reading_provenance is 'Provenance of reading_time_seconds, words_read, sessions_count ONLY; wordMethod/calendarMethod/timezone. NULL = legacy/unknown. Other rollup fields excluded.';
alter table public.reading_sessions add constraint session_word_method_valid check (
  word_estimation_method is null or (length(word_estimation_method) between 1 and 128 and
  (word_estimation_method <> 'session-duration-225-round-v1' or
    (duration_seconds is not null and duration_seconds >= 0 and words_estimated is not null and
     -- Match JS Number (binary64) division THEN multiplication; do not simplify
     -- to seconds * 3.75 or use numeric arithmetic. Math.round ties go upward,
     -- unlike round(float8)'s nearest-even ties. Compare the fractional part
     -- without adding 0.5 to the float (which can itself round at a boundary).
     words_estimated =
       floor((duration_seconds::double precision / 60::double precision) * 225::double precision)
       + case when
         (duration_seconds::double precision / 60::double precision) * 225::double precision
         - floor((duration_seconds::double precision / 60::double precision) * 225::double precision)
         >= 0.5::double precision then 1 else 0 end)))
);
alter table public.daily_stats add constraint reading_provenance_valid check (
  reading_provenance is null or (jsonb_typeof(reading_provenance) = 'object'
    and reading_provenance ?& array['wordMethod','calendarMethod','timezone']
    and jsonb_typeof(reading_provenance->'wordMethod') = 'string'
    and jsonb_typeof(reading_provenance->'calendarMethod') = 'string'
    and jsonb_typeof(reading_provenance->'timezone') = 'string'
    and length(reading_provenance->>'timezone') between 1 and 128)
);
-- Existing RLS and explicit relation grants cover additive columns. Reassert server-only access.
revoke all on table public.reading_sessions, public.daily_stats from public, anon, authenticated;
grant select, insert, update, delete on table public.reading_sessions, public.daily_stats to service_role;

create or replace function public.sync_upsert_reading_sessions(p_account_scope text, p_owner uuid, p_generation bigint, p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  perform public.validate_matter_sync_batch(p_rows, 100);
  with written as (
    insert into public.reading_sessions (id, item_id, started_at, ended_at, duration_seconds, source_device, words_estimated, word_estimation_method)
    select r.id, r.item_id, r.started_at, r.ended_at, r.duration_seconds, r.source_device, r.words_estimated, r.word_estimation_method from jsonb_populate_recordset(null::public.reading_sessions, p_rows) r
    on conflict (id) do update set
      item_id = excluded.item_id,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      duration_seconds = excluded.duration_seconds,
      source_device = excluded.source_device,
      words_estimated = excluded.words_estimated,
      word_estimation_method = excluded.word_estimation_method
    returning *
  ) select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into result from written w;
  return result;
end;
$$;

create or replace function public.sync_upsert_daily_stats(p_account_scope text, p_owner uuid, p_generation bigint, p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  perform public.validate_matter_sync_batch(p_rows, 100);
  if exists (select 1 from jsonb_array_elements(p_rows) r where r->'reading_provenance' is not null
    and r->'reading_provenance' <> 'null'::jsonb and not exists
      (select 1 from pg_catalog.pg_timezone_names where name = r->'reading_provenance'->>'timezone')) then
    raise exception 'Invalid provenance timezone' using errcode='22023';
  end if;
  with written as (
    insert into public.daily_stats (date, reading_time_seconds, words_read, sessions_count, items_read_count, highlights_count, top_source, reading_provenance)
    select r.date, r.reading_time_seconds, r.words_read, r.sessions_count, r.items_read_count, r.highlights_count, r.top_source, r.reading_provenance from jsonb_populate_recordset(null::public.daily_stats, p_rows) r
    on conflict (date) do update set
      reading_time_seconds = excluded.reading_time_seconds,
      words_read = excluded.words_read,
      sessions_count = excluded.sessions_count,
      items_read_count = excluded.items_read_count,
      highlights_count = excluded.highlights_count,
      top_source = excluded.top_source,
      reading_provenance = excluded.reading_provenance
    returning *
  ) select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into result from written w;
  return result;
end;
$$;

create or replace function public.validate_matter_page_rows(p_rows jsonb, p_kind text)
returns void language plpgsql immutable security invoker set search_path = '' as $$
declare fields text[]; max_rows integer;
begin
  case p_kind
    when 'items' then fields := array['id','title','url','source','author','content_type','status','word_count','estimated_reading_time_minutes','progress','created_at_matter','updated_at_matter','last_synced_at']; max_rows := 100;
    when 'sessions' then fields := array['id','item_id','started_at','ended_at','duration_seconds','source_device','words_estimated','word_estimation_method']; max_rows := 100;
    when 'tags' then fields := array['id','name','created_at_matter','updated_at_matter']; max_rows := 10000;
    when 'annotations' then fields := array['id','item_id','text','note','created_at_matter','updated_at_matter']; max_rows := 10000;
    when 'itemTags' then fields := array['item_id','tag_id']; max_rows := 10000;
    when 'daily' then fields := array['date','reading_time_seconds','words_read','sessions_count','items_read_count','highlights_count','top_source','reading_provenance']; max_rows := 1;
    else raise exception 'Invalid page row kind' using errcode = '22023';
  end case;
  perform public.validate_matter_sync_batch(p_rows, max_rows);
  if exists (select 1 from jsonb_array_elements(p_rows) r, lateral jsonb_object_keys(r) k where not k = any(fields)) then
    raise exception 'Unknown page row field' using errcode = '22023';
  end if;
  if p_kind in ('items','sessions','tags','annotations') and (
    exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r->'id') is distinct from 'string' or btrim(r->>'id') = '' or length(r->>'id') > 1024)
    or (select count(*) <> count(distinct r->>'id') from jsonb_array_elements(p_rows) r)
  ) then raise exception 'Invalid or duplicate page identity' using errcode = '22023'; end if;
end;
$$;


-- Explicit ACLs retained/reasserted; all replaced functions remain INVOKER and empty search_path.
revoke all on function public.sync_upsert_reading_sessions(text,uuid,bigint,jsonb), public.sync_upsert_daily_stats(text,uuid,bigint,jsonb), public.validate_matter_page_rows(jsonb,text) from public, anon, authenticated;
grant execute on function public.sync_upsert_reading_sessions(text,uuid,bigint,jsonb), public.sync_upsert_daily_stats(text,uuid,bigint,jsonb), public.validate_matter_page_rows(jsonb,text) to service_role;
