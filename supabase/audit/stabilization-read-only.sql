-- W0/W1 read-only verification. Run in the Supabase SQL editor only with an
-- already-authorized account. This script performs no writes.
select c.relname as object_name, c.relkind, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'matter_items','reading_sessions','matter_tags','item_tags','annotations',
  'daily_stats','sync_runs','sync_state','app_sessions','app_login_attempts',
  'matter_sync_streams','matter_sync_leases','matter_page_receipts','matter_dirty_rollups'
) order by c.relname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in (
  'matter_items','reading_sessions','matter_tags','item_tags','annotations',
  'daily_stats','sync_runs','sync_state','app_sessions','app_login_attempts',
  'matter_sync_streams','matter_sync_leases','matter_page_receipts','matter_dirty_rollups'
) order by table_name, grantee, privilege_type;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
order by routine_name, grantee;

select table_name, view_definition
from information_schema.views
where table_schema = 'public'
order by table_name;

select count(*) as session_count, min(started_at) as min_occurred_at,
  max(started_at) as max_occurred_at,
  coalesce(sum(duration_seconds), 0) as total_duration_seconds,
  count(*) filter (where item_id is null) as sessions_without_item
from public.reading_sessions;

select * from public.sync_runs order by started_at desc limit 1;
select * from public.sync_state where id = 'matter';

-- Include exact identities and PUBLIC ACLs for every helper and RPC.
select p.oid::regprocedure as signature, p.prosecdef as security_definer,
  p.proconfig as settings, p.proacl as grants
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname like '%matter_sync_lease'
  or p.proname='validate_matter_sync_batch' or p.proname like 'sync_%')
order by signature::text;

-- Task 13 exact function inventory (invoker, search_path and ACL).
select p.oid::regprocedure, p.prosecdef, p.proconfig, p.proacl
from pg_catalog.pg_proc p where p.oid in (
  'public.validate_matter_page_rows(jsonb,text)'::regprocedure,
  'public.commit_matter_page(text,uuid,bigint,uuid,jsonb,jsonb,boolean,text,text)'::regprocedure,
  'public.pending_matter_rollups(text,uuid,bigint,integer)'::regprocedure,
  'public.ack_matter_rollup(text,uuid,bigint,date,uuid,text,jsonb)'::regprocedure
) order by p.oid::regprocedure::text;
