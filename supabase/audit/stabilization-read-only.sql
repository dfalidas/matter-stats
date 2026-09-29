-- W0/W1 read-only verification. Run in the Supabase SQL editor only with an
-- already-authorized account. This script performs no writes.
select c.relname as object_name, c.relkind, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'matter_items','reading_sessions','matter_tags','item_tags','annotations',
  'daily_stats','sync_runs','sync_state','app_sessions','app_login_attempts'
) order by c.relname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in (
  'matter_items','reading_sessions','matter_tags','item_tags','annotations',
  'daily_stats','sync_runs','sync_state','app_sessions','app_login_attempts'
) order by table_name, grantee, privilege_type;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

select count(*) as session_count, min(started_at) as min_occurred_at,
  max(started_at) as max_occurred_at,
  coalesce(sum(duration_seconds), 0) as total_duration_seconds,
  count(*) filter (where item_id is null) as sessions_without_item
from public.reading_sessions;

select * from public.sync_runs order by started_at desc limit 1;
select * from public.sync_state where id = 'matter';
