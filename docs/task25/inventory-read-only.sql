-- A — stored-data aggregates
-- Personal outputs belong only in the private Craft log. No raw cursors/owners/bodies.
begin isolation level repeatable read read only;
set local statement_timeout='15s';
select transaction_timestamp() as observed_at, current_setting('transaction_read_only') as read_only,
jsonb_build_object(
 'sessions',(select jsonb_build_object('count',count(*),'earliest_valid',min(started_at) filter(where isfinite(started_at)),'latest_valid',max(started_at) filter(where isfinite(started_at)),
 'missing_timestamp',count(*) filter(where started_at is null),'nonfinite_timestamp',count(*) filter(where not isfinite(started_at)),
 'future_timestamp',count(*) filter(where started_at>transaction_timestamp()),'null_duration',count(*) filter(where duration_seconds is null),'negative_duration',count(*) filter(where duration_seconds<0),'zero_duration',count(*) filter(where duration_seconds=0),
 'duplicate_ids',count(*)-count(distinct id),'blank_ids',count(*) filter(where btrim(id)=''),
 'unlinked',count(*) filter(where item_id is null),'orphan_link',count(*) filter(where item_id is not null and not exists(select 1 from public.matter_items i where i.id=s.item_id)),
 'stored_words_missing',count(*) filter(where words_estimated is null),'unknown_method',count(*) filter(where word_estimation_method is null)) from public.reading_sessions s),
 'library',(select jsonb_build_object('items',count(*),'source_present',count(*) filter(where nullif(btrim(source),'') is not null),'author_present',count(*) filter(where nullif(btrim(author),'') is not null),'word_count_present',count(*) filter(where word_count is not null),'earliest_source_created',min(created_at_matter) filter(where isfinite(created_at_matter)),'latest_synced',max(last_synced_at)) from public.matter_items),
 'metadata',jsonb_build_object('tags',(select count(*) from public.matter_tags),'item_tag_links',(select count(*) from public.item_tags),'tagged_items',(select count(distinct item_id) from public.item_tags),'annotations',(select count(*) from public.annotations),'annotated_items',(select count(distinct item_id) from public.annotations)),
 'attribution',(select jsonb_build_object('linked_sessions',count(*),'linked_seconds',coalesce(sum(s.duration_seconds),0),'source_sessions',count(*) filter(where nullif(btrim(i.source),'') is not null),'author_sessions',count(*) filter(where nullif(btrim(i.author),'') is not null),'tag_sessions',count(*) filter(where exists(select 1 from public.item_tags t where t.item_id=i.id))) from public.reading_sessions s join public.matter_items i on i.id=s.item_id)
) as inventory;
rollback;

-- B — independent status and durable work
-- Personal outputs belong only in the private Craft log. No raw cursors/owners/bodies.
begin isolation level repeatable read read only;
set local statement_timeout='15s';
select transaction_timestamp() as observed_at, current_setting('transaction_read_only') as read_only,
jsonb_build_object(
 'streams',(select jsonb_agg(jsonb_build_object('stream',s.stream,'cycle_active',s.cycle_active,'cycle_started_at',s.cycle_started_at,'cycle_generation',s.cycle_generation,'coverage_window',s.coverage_window,'cursor_present',s.cursor is not null,'since_present',s.filters ? 'since','completed_watermark',s.completed_watermark,'retry_at',s.retry_at,'transition_status',s.transition_status,'last_state_update',s.updated_at,'terminal_observed_at',c.completed_at,'terminal_source_boundary',c.source_boundary,'terminal_cycle_generation',c.cycle_generation,'receipt_present',r.stream is not null) order by s.stream) from public.matter_sync_streams s left join public.matter_cycle_completions c using(stream) left join public.matter_page_receipts r using(stream)),
 'history',(select jsonb_build_object('coverage',coverage,'status',history_status,'requested_at',requested_at,'history_cycle_generation',history_cycle_generation,'completed_source_boundary',completed_at,'next_stream',next_stream) from public.matter_sync_continuation where account_scope='matter'),
 'attempts',(select jsonb_agg(jsonb_build_object('trigger',trigger,'attempted_at',attempted_at,'outcome',outcome,'finished_at',finished_at)) from public.matter_invocation_status),
 'lease',(select jsonb_build_object('expires_at',expires_at,'valid_at_observation',expires_at>transaction_timestamp()) from public.matter_sync_leases where account_scope='matter'),
 'retry',public.read_matter_retry_status(transaction_timestamp()),
 'legacy_cooldown',(select rate_limited_until from public.sync_state where id='matter'),
 'dirty_rollups',(select count(*) from public.matter_dirty_rollups),
 'preparation',(select jsonb_agg(jsonb_build_object('slot',slot,'contract_present',contract is not null,'entries',(select count(*) from jsonb_each(requests)),'cached_success',(select count(*) from jsonb_each(requests) e where e.value ? 'value'),'exhausted',(select count(*) from jsonb_each(requests) e where coalesce((e.value->>'attempts')::integer,0)>=3),'ambiguous_pending',(select count(*) from jsonb_each(requests) e where e.value->>'pending'='true'))) from public.matter_request_work),
 'generation',public.read_matter_generation_status(),
 'recent_runs',(select jsonb_agg(to_jsonb(r)) from (select started_at,finished_at,status,sync_mode,items_synced,sessions_synced,annotations_synced,tags_synced,matter_has_more,matter_sessions_skipped,(error_message is not null) as error_present from public.sync_runs order by started_at desc limit 8) r),
 'last_record_write',(select jsonb_build_object('session_updated_at',max(updated_at),'session_created_at',max(created_at)) from public.reading_sessions)
) as status;
rollback;

-- C — integrity and optional migration-history presence
-- Personal outputs belong only in the private Craft log. No raw cursors/owners/bodies.
begin isolation level repeatable read read only; set local statement_timeout='15s'; select transaction_timestamp() observed_at, jsonb_build_object('orphan_tag_links',(select count(*) from public.item_tags t where not exists(select 1 from public.matter_tags g where g.id=t.tag_id) or not exists(select 1 from public.matter_items i where i.id=t.item_id)),'orphan_annotations',(select count(*) from public.annotations a where not exists(select 1 from public.matter_items i where i.id=a.item_id)),'end_before_start',(select count(*) from public.reading_sessions where ended_at<started_at),'nonfinite_end',(select count(*) from public.reading_sessions where not isfinite(ended_at)),'missing_end',(select count(*) from public.reading_sessions where ended_at is null),'migration_history_table_present',to_regclass('supabase_migrations.schema_migrations') is not null) checks; rollback;
