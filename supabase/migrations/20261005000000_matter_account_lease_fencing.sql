-- Task 12 / E2 / W4 / R4. Apply before the fenced runtime, with old sync writers
-- disabled and drained. This migration does not fence old ordinary table writes.
-- No existing domain, stream, retry or run rows are rewritten.
create table public.matter_sync_leases (
  account_scope text primary key check (account_scope = 'matter'),
  owner uuid,
  expires_at timestamptz,
  generation bigint not null default 0 check (generation >= 0),
  constraint matter_sync_lease_owner_expiry check ((owner is null) = (expires_at is null))
);
comment on table public.matter_sync_leases is
  'Durable singleton account lease. Never delete/reset generation. Independent of stream cycle_generation.';
alter table public.matter_sync_leases enable row level security;
revoke all on table public.matter_sync_leases from public, anon, authenticated, service_role;
-- Deliberately omit INSERT, DELETE and TRUNCATE so the service role cannot reset
-- generation by deleting/recreating the durable row. Owner/expiry/generation are
-- used only by these RPCs in production; administrative direct UPDATE is trusted.
grant select, update on table public.matter_sync_leases to service_role;
insert into public.matter_sync_leases(account_scope) values ('matter');

create function public.acquire_matter_sync_lease(p_account_scope text, p_owner uuid, p_ttl_seconds integer)
returns table(generation text, expires_at timestamptz)
language plpgsql volatile security invoker set search_path = '' as $$
declare v public.matter_sync_leases; v_now timestamptz;
begin
  if p_account_scope is distinct from 'matter' or p_owner is null
     or p_ttl_seconds is null or p_ttl_seconds not between 30 and 300 then
    raise exception 'Invalid Matter lease scope, owner or TTL' using errcode = '22023';
  end if;
  select * into v from public.matter_sync_leases l where l.account_scope = p_account_scope for update;
  if not found then raise exception 'Matter lease infrastructure missing' using errcode = '55000'; end if;
  -- Sample database wall-clock AFTER any lock wait, not transaction-start now().
  v_now := clock_timestamp();
  if v.owner is not null and v.expires_at > v_now then return; end if;
  return query update public.matter_sync_leases l
    set owner = p_owner, expires_at = v_now + make_interval(secs => p_ttl_seconds), generation = l.generation + 1
    where l.account_scope = p_account_scope returning l.generation::text, l.expires_at;
end;
$$;

create function public.assert_matter_sync_lease(p_account_scope text, p_owner uuid, p_generation bigint)
returns void language plpgsql volatile security invoker set search_path = '' as $$
declare v public.matter_sync_leases;
begin
  select * into v from public.matter_sync_leases l where l.account_scope = p_account_scope for update;
  if not found or p_account_scope is distinct from 'matter' or p_owner is null
     or p_generation is null or p_generation <= 0 or v.owner is distinct from p_owner
     or v.generation is distinct from p_generation or v.expires_at is null or v.expires_at <= clock_timestamp() then
    raise exception 'Matter sync lease lost' using errcode = '55000';
  end if;
  -- The row lock survives this helper until the CALLER'S transaction ends.
end;
$$;

create function public.renew_matter_sync_lease(p_account_scope text, p_owner uuid, p_generation bigint, p_ttl_seconds integer)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  if p_ttl_seconds is null or p_ttl_seconds not between 30 and 300 then
    raise exception 'Invalid Matter lease TTL' using errcode = '22023';
  end if;
  begin
    perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  exception when sqlstate '55000' then return false;
  end;
  update public.matter_sync_leases set expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds)
    where account_scope = p_account_scope;
  return true;
end;
$$;

create function public.release_matter_sync_lease(p_account_scope text, p_owner uuid, p_generation bigint)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  begin
    perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  exception when sqlstate '55000' then return false;
  end;
  update public.matter_sync_leases set owner = null, expires_at = null where account_scope = p_account_scope;
  return true;
end;
$$;

create function public.validate_matter_sync_batch(p_rows jsonb, p_max_rows integer)
returns void language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Matter mutation requires an array' using errcode = '22023';
  end if;
  if p_max_rows is null or p_max_rows not between 1 and 10000 or jsonb_array_length(p_rows) > p_max_rows
     or exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r) <> 'object') then
    raise exception 'Invalid Matter mutation batch' using errcode = '22023';
  end if;
end;
$$;

-- Fixed relation and typed row conversion; never dynamic SQL or table arguments.
create function public.sync_upsert_matter_items(p_account_scope text, p_owner uuid, p_generation bigint, p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  perform public.validate_matter_sync_batch(p_rows, 100);
  with written as (
    insert into public.matter_items (id, title, url, source, author, content_type, status, word_count, estimated_reading_time_minutes, progress, created_at_matter, updated_at_matter, last_synced_at)
    select r.id, r.title, r.url, r.source, r.author, r.content_type, r.status, r.word_count, r.estimated_reading_time_minutes, r.progress, r.created_at_matter, r.updated_at_matter, r.last_synced_at from jsonb_populate_recordset(null::public.matter_items, p_rows) r
    on conflict (id) do update set
      title = excluded.title,
      url = excluded.url,
      source = excluded.source,
      author = excluded.author,
      content_type = excluded.content_type,
      status = excluded.status,
      word_count = excluded.word_count,
      estimated_reading_time_minutes = excluded.estimated_reading_time_minutes,
      progress = excluded.progress,
      created_at_matter = excluded.created_at_matter,
      updated_at_matter = excluded.updated_at_matter,
      last_synced_at = excluded.last_synced_at
    returning *
  ) select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into result from written w;
  return result;
end;
$$;

-- Fixed relation and typed row conversion; never dynamic SQL or table arguments.
create function public.sync_upsert_reading_sessions(p_account_scope text, p_owner uuid, p_generation bigint, p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  perform public.validate_matter_sync_batch(p_rows, 100);
  with written as (
    insert into public.reading_sessions (id, item_id, started_at, ended_at, duration_seconds, source_device, words_estimated)
    select r.id, r.item_id, r.started_at, r.ended_at, r.duration_seconds, r.source_device, r.words_estimated from jsonb_populate_recordset(null::public.reading_sessions, p_rows) r
    on conflict (id) do update set
      item_id = excluded.item_id,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      duration_seconds = excluded.duration_seconds,
      source_device = excluded.source_device,
      words_estimated = excluded.words_estimated
    returning *
  ) select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into result from written w;
  return result;
end;
$$;

-- Fixed relation and typed row conversion; never dynamic SQL or table arguments.
create function public.sync_upsert_matter_tags(p_account_scope text, p_owner uuid, p_generation bigint, p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  perform public.validate_matter_sync_batch(p_rows, 100);
  with written as (
    insert into public.matter_tags (id, name, created_at_matter, updated_at_matter)
    select r.id, r.name, r.created_at_matter, r.updated_at_matter from jsonb_populate_recordset(null::public.matter_tags, p_rows) r
    on conflict (id) do update set
      name = excluded.name,
      created_at_matter = excluded.created_at_matter,
      updated_at_matter = excluded.updated_at_matter
    returning *
  ) select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into result from written w;
  return result;
end;
$$;

-- Fixed relation and typed row conversion; never dynamic SQL or table arguments.
create function public.sync_upsert_annotations(p_account_scope text, p_owner uuid, p_generation bigint, p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  perform public.validate_matter_sync_batch(p_rows, 100);
  with written as (
    insert into public.annotations (id, item_id, text, note, created_at_matter, updated_at_matter)
    select r.id, r.item_id, r.text, r.note, r.created_at_matter, r.updated_at_matter from jsonb_populate_recordset(null::public.annotations, p_rows) r
    on conflict (id) do update set
      item_id = excluded.item_id,
      text = excluded.text,
      note = excluded.note,
      created_at_matter = excluded.created_at_matter,
      updated_at_matter = excluded.updated_at_matter
    returning *
  ) select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into result from written w;
  return result;
end;
$$;

-- Fixed relation and typed row conversion; never dynamic SQL or table arguments.
create function public.sync_upsert_daily_stats(p_account_scope text, p_owner uuid, p_generation bigint, p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  perform public.validate_matter_sync_batch(p_rows, 100);
  with written as (
    insert into public.daily_stats (date, reading_time_seconds, words_read, sessions_count, items_read_count, highlights_count, top_source)
    select r.date, r.reading_time_seconds, r.words_read, r.sessions_count, r.items_read_count, r.highlights_count, r.top_source from jsonb_populate_recordset(null::public.daily_stats, p_rows) r
    on conflict (date) do update set
      reading_time_seconds = excluded.reading_time_seconds,
      words_read = excluded.words_read,
      sessions_count = excluded.sessions_count,
      items_read_count = excluded.items_read_count,
      highlights_count = excluded.highlights_count,
      top_source = excluded.top_source
    returning *
  ) select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into result from written w;
  return result;
end;
$$;

create function public.sync_replace_item_tags(p_account_scope text, p_owner uuid, p_generation bigint, p_item_ids text[], p_rows jsonb)
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  perform public.validate_matter_sync_batch(p_rows, 10000);
  if p_item_ids is null or cardinality(p_item_ids) not between 1 and 100
     or exists (select 1 from unnest(p_item_ids) id where id is null or btrim(id) = '')
     or exists (select 1 from jsonb_populate_recordset(null::public.item_tags, p_rows) r
       where r.item_id is null or not (r.item_id = any(p_item_ids))) then
    raise exception 'Invalid item tag replacement scope' using errcode = '22023';
  end if;
  delete from public.item_tags where item_id = any(p_item_ids);
  insert into public.item_tags(item_id, tag_id)
    select r.item_id, r.tag_id from jsonb_populate_recordset(null::public.item_tags, p_rows) r;
end;
$$;

create function public.sync_upsert_stream(p_account_scope text, p_owner uuid, p_generation bigint, p_state jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare v public.matter_sync_streams; result public.matter_sync_streams;
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'Invalid stream state' using errcode = '22023';
  end if;
  v := jsonb_populate_record(null::public.matter_sync_streams, p_state);
  insert into public.matter_sync_streams(stream,endpoint,filters,page_limit,cursor,cycle_started_at,cycle_generation,completed_watermark,retry_at,cycle_active,transition_status,coverage_window)
  values(v.stream,v.endpoint,v.filters,v.page_limit,v.cursor,v.cycle_started_at,v.cycle_generation,v.completed_watermark,v.retry_at,v.cycle_active,v.transition_status,v.coverage_window)
  on conflict(stream) do update set endpoint=excluded.endpoint, filters=excluded.filters, page_limit=excluded.page_limit,
    cursor=excluded.cursor, cycle_started_at=excluded.cycle_started_at, cycle_generation=excluded.cycle_generation,
    completed_watermark=excluded.completed_watermark, retry_at=excluded.retry_at, cycle_active=excluded.cycle_active,
    transition_status=excluded.transition_status, coverage_window=excluded.coverage_window
  returning * into result;
  return to_jsonb(result);
end;
$$;

create function public.sync_create_run(p_account_scope text, p_owner uuid, p_generation bigint, p_started_at timestamptz, p_sync_mode text)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare result public.sync_runs;
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  if p_started_at is null or p_sync_mode is null or p_sync_mode not in ('recent_activity','recent_activity_manual','recent_activity_scheduled','backfill_library') then
    raise exception 'Invalid sync run' using errcode = '22023';
  end if;
  -- Invocation UUID doubles as its run ID; no changes to legacy run rows/schema.
  insert into public.sync_runs(id,status,started_at,sync_mode) values(p_owner,'running',p_started_at,p_sync_mode) returning * into result;
  return to_jsonb(result);
end;
$$;

create function public.sync_update_run(p_account_scope text, p_owner uuid, p_generation bigint, p_id uuid, p_patch jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare v public.sync_runs; result public.sync_runs;
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  if p_id is distinct from p_owner or p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in (
       'status','finished_at','items_synced','sessions_synced','annotations_synced','tags_synced','sync_mode',
       'matter_requests_count','matter_sessions_returned','matter_items_returned','matter_sessions_skipped',
       'matter_sessions_without_linked_item','matter_first_session_shape','matter_has_more','matter_next_cursor_present',
       'error_message','checkpoint_timestamp')) then
    raise exception 'Invalid sync run patch' using errcode = '22023';
  end if;
  select * into v from public.sync_runs where id = p_id for update;
  if not found then raise exception 'Invocation run missing' using errcode = '55000'; end if;
  v := jsonb_populate_record(v, p_patch);
  update public.sync_runs set status=v.status, finished_at=v.finished_at,
    items_synced=v.items_synced, sessions_synced=v.sessions_synced, annotations_synced=v.annotations_synced, tags_synced=v.tags_synced,
    sync_mode=v.sync_mode, matter_requests_count=v.matter_requests_count, matter_sessions_returned=v.matter_sessions_returned,
    matter_items_returned=v.matter_items_returned, matter_sessions_skipped=v.matter_sessions_skipped,
    matter_sessions_without_linked_item=v.matter_sessions_without_linked_item, matter_first_session_shape=v.matter_first_session_shape,
    matter_has_more=v.matter_has_more, matter_next_cursor_present=v.matter_next_cursor_present,
    error_message=v.error_message, checkpoint_timestamp=v.checkpoint_timestamp
  where id=p_id returning * into result;
  return to_jsonb(result);
end;
$$;

-- Exact signatures include helpers: PostgreSQL defaults new functions to PUBLIC EXECUTE.
revoke all on function public.acquire_matter_sync_lease(text,uuid,integer) from public, anon, authenticated;
grant execute on function public.acquire_matter_sync_lease(text,uuid,integer) to service_role;
revoke all on function public.assert_matter_sync_lease(text,uuid,bigint) from public, anon, authenticated;
grant execute on function public.assert_matter_sync_lease(text,uuid,bigint) to service_role;
revoke all on function public.renew_matter_sync_lease(text,uuid,bigint,integer) from public, anon, authenticated;
grant execute on function public.renew_matter_sync_lease(text,uuid,bigint,integer) to service_role;
revoke all on function public.release_matter_sync_lease(text,uuid,bigint) from public, anon, authenticated;
grant execute on function public.release_matter_sync_lease(text,uuid,bigint) to service_role;
revoke all on function public.validate_matter_sync_batch(jsonb,integer) from public, anon, authenticated;
grant execute on function public.validate_matter_sync_batch(jsonb,integer) to service_role;
revoke all on function public.sync_upsert_matter_items(text,uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.sync_upsert_matter_items(text,uuid,bigint,jsonb) to service_role;
revoke all on function public.sync_upsert_reading_sessions(text,uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.sync_upsert_reading_sessions(text,uuid,bigint,jsonb) to service_role;
revoke all on function public.sync_upsert_matter_tags(text,uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.sync_upsert_matter_tags(text,uuid,bigint,jsonb) to service_role;
revoke all on function public.sync_upsert_annotations(text,uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.sync_upsert_annotations(text,uuid,bigint,jsonb) to service_role;
revoke all on function public.sync_upsert_daily_stats(text,uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.sync_upsert_daily_stats(text,uuid,bigint,jsonb) to service_role;
revoke all on function public.sync_replace_item_tags(text,uuid,bigint,text[],jsonb) from public, anon, authenticated;
grant execute on function public.sync_replace_item_tags(text,uuid,bigint,text[],jsonb) to service_role;
revoke all on function public.sync_upsert_stream(text,uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.sync_upsert_stream(text,uuid,bigint,jsonb) to service_role;
revoke all on function public.sync_create_run(text,uuid,bigint,timestamp with time zone,text) from public, anon, authenticated;
grant execute on function public.sync_create_run(text,uuid,bigint,timestamp with time zone,text) to service_role;
revoke all on function public.sync_update_run(text,uuid,bigint,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.sync_update_run(text,uuid,bigint,uuid,jsonb) to service_role;
