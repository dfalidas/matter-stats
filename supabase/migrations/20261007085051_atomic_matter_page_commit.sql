-- Task 13. Additive; preserves all legacy, stream and Task 12 lease state.
-- Deploy before code, with every old page writer disabled and drained.
create table public.matter_page_receipts (
  stream text primary key references public.matter_sync_streams(stream),
  receipt_id uuid not null,
  fingerprint text not null
);
create table public.matter_dirty_rollups (
  date date primary key,
  revision uuid not null,
  timezone text not null
);
alter table public.matter_page_receipts enable row level security;
alter table public.matter_dirty_rollups enable row level security;
revoke all on table public.matter_page_receipts, public.matter_dirty_rollups from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.matter_page_receipts, public.matter_dirty_rollups to service_role;
comment on table public.matter_page_receipts is 'Bounded latest-page receipt per stream. Older receipts reject via durable stream comparison.';
comment on table public.matter_dirty_rollups is 'Pending local calendar dates; each page commit replaces revision with a fresh database UUID.';

create function public.validate_matter_page_rows(p_rows jsonb, p_kind text)
returns void language plpgsql immutable security invoker set search_path = '' as $$
declare fields text[]; max_rows integer;
begin
  case p_kind
    when 'items' then fields := array['id','title','url','source','author','content_type','status','word_count','estimated_reading_time_minutes','progress','created_at_matter','updated_at_matter','last_synced_at']; max_rows := 100;
    when 'sessions' then fields := array['id','item_id','started_at','ended_at','duration_seconds','source_device','words_estimated']; max_rows := 100;
    when 'tags' then fields := array['id','name','created_at_matter','updated_at_matter']; max_rows := 10000;
    when 'annotations' then fields := array['id','item_id','text','note','created_at_matter','updated_at_matter']; max_rows := 10000;
    when 'itemTags' then fields := array['item_id','tag_id']; max_rows := 10000;
    when 'daily' then fields := array['date','reading_time_seconds','words_read','sessions_count','items_read_count','highlights_count','top_source']; max_rows := 1;
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

create function public.commit_matter_page(p_account_scope text, p_owner uuid, p_generation bigint,
  p_receipt_id uuid, p_previous_receipt_id uuid, p_expected jsonb, p_plan jsonb, p_has_more boolean, p_next_cursor text, p_timezone text)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  current_stream public.matter_sync_streams; expected public.matter_sync_streams;
  receipt public.matter_page_receipts; fingerprint text; revision uuid;
  dirty_dates date[]; metadata_dates date[]; ids text[]; batch jsonb; kind text; i integer;
begin
  perform public.assert_matter_sync_lease(p_account_scope, p_owner, p_generation);
  -- The account row lock remains held across every write and the checkpoint.
  if p_receipt_id is null or p_has_more is null or p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone)
     or jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_plan) is distinct from 'object'
     or octet_length(p_plan::text) > 4194304 or octet_length(p_expected::text) > 16384 then
    raise exception 'Invalid page envelope or bounds' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_expected) k where k not in
    ('stream','endpoint','filters','page_limit','cursor','cycle_started_at','cycle_generation','completed_watermark','retry_at','cycle_active','transition_status','coverage_window'))
    or exists (select 1 from jsonb_object_keys(p_plan) k where k not in ('placeholders','items','sessions','tags','itemTagIds','itemTags','annotations'))
    or not p_plan ?& array['placeholders','items','sessions','tags','itemTagIds','itemTags','annotations'] then
    raise exception 'Unknown or missing page fields' using errcode = '22023';
  end if;
  expected := jsonb_populate_record(null::public.matter_sync_streams, p_expected);
  if expected.stream is null or expected.stream not in ('recent_sessions','library_items') or expected.cycle_active is distinct from true
     or expected.page_limit is null or expected.page_limit not between 1 and 100
     or expected.cycle_started_at is null or expected.cycle_generation is null
     or (p_has_more and (p_next_cursor is null or btrim(p_next_cursor) = '' or length(p_next_cursor)>4096 or p_next_cursor is not distinct from expected.cursor))
     or (not p_has_more and p_next_cursor is not null) then
    raise exception 'Invalid page continuation' using errcode = '22023';
  end if;
  if expected.endpoint is distinct from (case when expected.stream='recent_sessions' then '/reading_sessions' else '/items' end)
    or jsonb_typeof(expected.filters) is distinct from 'object'
    or exists(select 1 from jsonb_each(expected.filters) f where jsonb_typeof(f.value)<>'string')
    or (expected.stream='recent_sessions' and exists(select 1 from jsonb_object_keys(expected.filters) k where k<>'since'))
    or (expected.stream='library_items' and (expected.filters->>'status' is distinct from 'all' or expected.filters->>'order' is distinct from 'updated'
      or exists(select 1 from jsonb_object_keys(expected.filters) k where k not in ('status','order','updated_since')))) then
    raise exception 'Invalid page request contract' using errcode='22023';
  end if;
  select * into current_stream from public.matter_sync_streams where stream=expected.stream for update;
  if not found then raise exception 'Missing stream' using errcode = 'PT409'; end if;
  fingerprint := md5(jsonb_build_object('previous',p_previous_receipt_id,'expected',p_expected,'plan',p_plan,'more',p_has_more,'next',p_next_cursor,'timezone',p_timezone)::text);
  select * into receipt from public.matter_page_receipts where stream=expected.stream;
  if receipt.receipt_id = p_receipt_id then
    if receipt.fingerprint is distinct from fingerprint then raise exception 'Divergent page receipt' using errcode = '22023'; end if;
    return to_jsonb(current_stream); -- durable state, with no writes or new markers
  end if;
  if receipt.receipt_id is distinct from p_previous_receipt_id or current_stream.cycle_active is distinct from true or
    row(current_stream.endpoint,current_stream.filters,current_stream.page_limit,current_stream.cursor,current_stream.cycle_started_at,current_stream.cycle_generation,current_stream.completed_watermark,current_stream.coverage_window,current_stream.transition_status)
    is distinct from row(expected.endpoint,expected.filters,expected.page_limit,expected.cursor,expected.cycle_started_at,expected.cycle_generation,expected.completed_watermark,expected.coverage_window,expected.transition_status) then
    -- A contract conflict is permanent for this request, not a serialization
    -- failure: 40001 can trigger infinite retries in PostgREST 14.
    raise exception 'Stale or divergent page transition' using errcode = 'PT409';
  end if;
  -- Only known operations and fields; never table-name or SQL arguments.
  perform public.validate_matter_page_rows(p_plan->'placeholders','items');
  foreach kind in array array['items','sessions','tags','annotations','itemTags'] loop
    perform public.validate_matter_page_rows(p_plan->kind,kind);
  end loop;
  if jsonb_typeof(p_plan->'itemTagIds') is distinct from 'array' or jsonb_array_length(p_plan->'itemTagIds')>100
    or exists (select 1 from jsonb_array_elements(p_plan->'itemTagIds') r where jsonb_typeof(r) <> 'string' or btrim(r#>>'{}')='' or length(r#>>'{}')>1024) then
    raise exception 'Invalid tag replacement IDs' using errcode = '22023';
  end if;
  select coalesce(array_agg(value),array[]::text[]) into ids from jsonb_array_elements_text(p_plan->'itemTagIds');
  if cardinality(ids) <> (select count(distinct id) from unnest(ids) id)
    or exists (select 1 from jsonb_populate_recordset(null::public.item_tags,p_plan->'itemTags') r where r.item_id is null or not r.item_id=any(ids) or r.tag_id is null)
    or (select count(*) <> count(distinct (r.item_id,r.tag_id)) from jsonb_populate_recordset(null::public.item_tags,p_plan->'itemTags') r) then
    raise exception 'Invalid tag replacement scope' using errcode = '22023';
  end if;
  if jsonb_array_length(p_plan->(case when expected.stream='library_items' then 'items' else 'sessions' end))>expected.page_limit then
    raise exception 'Page rows exceed fixed limit' using errcode='22023';
  end if;
  if expected.stream='library_items' and jsonb_array_length(p_plan->'sessions')<>0 then
    raise exception 'Library page cannot import sessions' using errcode = '22023';
  end if;
  -- Read old effects consistently BEFORE overwriting rows. Bound metadata-related
  -- history to 10,000 sessions; refuse a larger page instead of dropping dates.
  select array_agg(d) into metadata_dates from (
    select (s.started_at at time zone p_timezone)::date d
    from public.reading_sessions s
    join jsonb_populate_recordset(null::public.matter_items,p_plan->'items') n on n.id=s.item_id
    left join public.matter_items o on o.id=n.id
    where row(o.source,o.status,o.progress) is distinct from row(n.source,n.status,n.progress)
    limit 10001
  ) effects;
  if cardinality(metadata_dates)>10000 then raise exception 'Metadata rollup effects exceed page bound' using errcode='22023'; end if;
  select array_agg(distinct d) filter(where d is not null) into dirty_dates from (
    select unnest(metadata_dates) d
    union all
    select (n.started_at at time zone p_timezone)::date from jsonb_populate_recordset(null::public.reading_sessions,p_plan->'sessions') n
      left join public.reading_sessions o on o.id=n.id
      where row(o.item_id,o.started_at,o.ended_at,o.duration_seconds,o.source_device,o.words_estimated) is distinct from row(n.item_id,n.started_at,n.ended_at,n.duration_seconds,n.source_device,n.words_estimated)
    union all
    select (o.started_at at time zone p_timezone)::date from jsonb_populate_recordset(null::public.reading_sessions,p_plan->'sessions') n
      join public.reading_sessions o on o.id=n.id
      where row(o.item_id,o.started_at,o.ended_at,o.duration_seconds,o.source_device,o.words_estimated) is distinct from row(n.item_id,n.started_at,n.ended_at,n.duration_seconds,n.source_device,n.words_estimated)
    union all
    select (n.created_at_matter at time zone p_timezone)::date from jsonb_populate_recordset(null::public.annotations,p_plan->'annotations') n
      left join public.annotations o on o.id=n.id
      where row(o.item_id,o.text,o.note,o.created_at_matter,o.updated_at_matter) is distinct from row(n.item_id,n.text,n.note,n.created_at_matter,n.updated_at_matter)
    union all
    select (o.created_at_matter at time zone p_timezone)::date from jsonb_populate_recordset(null::public.annotations,p_plan->'annotations') n
      join public.annotations o on o.id=n.id
      where row(o.item_id,o.text,o.note,o.created_at_matter,o.updated_at_matter) is distinct from row(n.item_id,n.text,n.note,n.created_at_matter,n.updated_at_matter)
  ) effects;
  -- Placeholders are insert-only; optional enrichment must never erase existing metadata.
  insert into public.matter_items(id,title,url,source,author,content_type,status,word_count,estimated_reading_time_minutes,progress,created_at_matter,updated_at_matter,last_synced_at)
    select r.id,r.title,r.url,r.source,r.author,r.content_type,r.status,r.word_count,r.estimated_reading_time_minutes,r.progress,r.created_at_matter,r.updated_at_matter,r.last_synced_at
    from jsonb_populate_recordset(null::public.matter_items,p_plan->'placeholders') r on conflict(id) do nothing;
  perform public.sync_upsert_matter_items(p_account_scope,p_owner,p_generation,p_plan->'items');
  -- Internal fixed-purpose functions share THIS transaction (not separate RPCs).
  foreach kind in array array['tags','annotations'] loop
    for i in 0..((jsonb_array_length(p_plan->kind)-1)/100) loop
      select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into batch
        from jsonb_array_elements(p_plan->kind) with ordinality r(value,ord) where ord>i*100 and ord<=(i+1)*100;
      if kind='tags' then perform public.sync_upsert_matter_tags(p_account_scope,p_owner,p_generation,batch);
      else perform public.sync_upsert_annotations(p_account_scope,p_owner,p_generation,batch); end if;
    end loop;
  end loop;
  if cardinality(ids)>0 then perform public.sync_replace_item_tags(p_account_scope,p_owner,p_generation,ids,p_plan->'itemTags'); end if;
  perform public.sync_upsert_reading_sessions(p_account_scope,p_owner,p_generation,p_plan->'sessions');
  revision := pg_catalog.gen_random_uuid();
  insert into public.matter_dirty_rollups(date,revision,timezone)
    select d,revision,p_timezone from unnest(dirty_dates) d
    on conflict(date) do update set revision=excluded.revision,timezone=excluded.timezone;
  -- Preserve filters/limit, coverage and cooldown; exhaustion promotes ONLY fixed start.
  update public.matter_sync_streams set cursor=p_next_cursor, cycle_active=p_has_more,
    cycle_started_at=case when p_has_more then current_stream.cycle_started_at else null end,
    completed_watermark=case when p_has_more then current_stream.completed_watermark else current_stream.cycle_started_at end,
    transition_status=case when p_has_more then current_stream.transition_status else 'native' end
    where stream=expected.stream returning * into current_stream;
  insert into public.matter_page_receipts(stream,receipt_id,fingerprint) values(expected.stream,p_receipt_id,fingerprint)
    on conflict(stream) do update set receipt_id=excluded.receipt_id,fingerprint=excluded.fingerprint;
  return to_jsonb(current_stream);
end;
$$;

create function public.pending_matter_rollups(p_account_scope text,p_owner uuid,p_generation bigint,p_limit integer)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare result jsonb;
begin
  perform public.assert_matter_sync_lease(p_account_scope,p_owner,p_generation);
  if p_limit is null or p_limit not between 1 and 32 then raise exception 'Invalid rollup work bound' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.date),'[]'::jsonb) into result
    from (select * from public.matter_dirty_rollups order by date limit p_limit) r;
  return result;
end;
$$;
create function public.ack_matter_rollup(p_account_scope text,p_owner uuid,p_generation bigint,p_date date,p_revision uuid,p_timezone text,p_row jsonb)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare marker public.matter_dirty_rollups;
begin
  perform public.assert_matter_sync_lease(p_account_scope,p_owner,p_generation);
  if p_date is null or p_revision is null or p_timezone is null or p_row is null or octet_length(p_row::text)>16384 then
    raise exception 'Invalid rollup acknowledgement' using errcode='22023';
  end if;
  perform public.validate_matter_page_rows(jsonb_build_array(p_row),'daily');
  if (p_row->>'date')::date is distinct from p_date then raise exception 'Mismatched rollup date' using errcode='22023'; end if;
  select * into marker from public.matter_dirty_rollups where date=p_date for update;
  if not found or marker.revision is distinct from p_revision or marker.timezone is distinct from p_timezone then return false; end if;
  perform public.sync_upsert_daily_stats(p_account_scope,p_owner,p_generation,jsonb_build_array(p_row));
  delete from public.matter_dirty_rollups where date=p_date and revision=p_revision and timezone=p_timezone;
  return true;
end;
$$;
revoke all on function public.validate_matter_page_rows(jsonb,text), public.commit_matter_page(text,uuid,bigint,uuid,uuid,jsonb,jsonb,boolean,text,text), public.pending_matter_rollups(text,uuid,bigint,integer), public.ack_matter_rollup(text,uuid,bigint,date,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.validate_matter_page_rows(jsonb,text), public.commit_matter_page(text,uuid,bigint,uuid,uuid,jsonb,jsonb,boolean,text,text), public.pending_matter_rollups(text,uuid,bigint,integer), public.ack_matter_rollup(text,uuid,bigint,date,uuid,text,jsonb) to service_role;
