-- Task 14 follow-up: explicitly bound the account update to its two streams.
-- Compatible with PostgREST sessions enforcing safeupdate; never disable it.
-- Retains the existing signature, fencing, ACLs, cursor/contract and dirty work.
create or replace function public.cooldown_matter_account(p_account_scope text,p_owner uuid,p_generation bigint,p_retry_at timestamptz)
returns void language plpgsql volatile security invoker set search_path='' as $$
begin
  perform public.assert_matter_sync_lease(p_account_scope,p_owner,p_generation);
  if p_retry_at is null then raise exception 'Missing cooldown' using errcode='22023'; end if;
  update public.matter_sync_streams set retry_at=greatest(retry_at,p_retry_at)
    where stream in ('recent_sessions','library_items');
end;
$$;
revoke all on function public.cooldown_matter_account(text,uuid,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.cooldown_matter_account(text,uuid,bigint,timestamptz) to service_role;
