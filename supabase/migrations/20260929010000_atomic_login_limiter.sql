-- Serialize the limiter decision and attempt record for each client key. The
-- service role is the only caller; browser roles cannot execute this RPC.
create or replace function public.record_app_login_attempt(
  p_client_key_hash text,
  p_succeeded boolean,
  p_limit integer default 5,
  p_window_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  recent_failures integer;
begin
  if length(p_client_key_hash) <> 64 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid login limiter arguments' using errcode = '22023';
  end if;

  -- The transaction-scoped lock makes count+insert one decision across all
  -- serverless instances. Hash collisions only make limiting more conservative.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_key_hash, 0));

  delete from public.app_login_attempts
  where client_key_hash = p_client_key_hash
    and attempted_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds);

  select count(*) into recent_failures
  from public.app_login_attempts
  where client_key_hash = p_client_key_hash
    and not succeeded
    and attempted_at >= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds);

  if recent_failures >= p_limit then
    return false;
  end if;

  insert into public.app_login_attempts (client_key_hash, attempted_at, succeeded)
  values (p_client_key_hash, pg_catalog.now(), p_succeeded);
  return true;
end;
$$;

revoke all on function public.record_app_login_attempt(text, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_app_login_attempt(text, boolean, integer, integer)
  to service_role;

comment on function public.record_app_login_attempt(text, boolean, integer, integer) is
  'Atomically decides and records a per-client app login attempt; service_role only.';
