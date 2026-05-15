-- Persist Matter API backoff windows so manual syncs avoid calling Matter while
-- the account is still rate limited.

alter table public.sync_state
  add column if not exists rate_limited_until timestamptz;

comment on column public.sync_state.rate_limited_until is
  'When set in the future, manual Matter syncs should not call the Matter API until this timestamp has passed.';

create index if not exists sync_state_rate_limited_until_idx on public.sync_state (rate_limited_until);
