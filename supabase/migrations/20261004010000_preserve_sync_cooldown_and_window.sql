-- Follow-up for Task 11: retain the user's explicit session coverage intent and
-- carry forward an account cooldown without treating legacy cursor state as valid.
alter table public.matter_sync_streams
  add column if not exists coverage_window text
    check (coverage_window is null or coverage_window in ('7_days', '30_days', '90_days', 'current_year', 'all'));

comment on column public.matter_sync_streams.coverage_window is
  'Explicit initial session history policy. NULL denotes a scheduled/default continuation or the library stream.';

update public.matter_sync_streams
set coverage_window = 'current_year'
where stream = 'recent_sessions'
  and coverage_window is null
  and transition_status = 'legacy_recoverable_restart';

update public.matter_sync_streams streams
set retry_at = greatest(streams.retry_at, legacy.rate_limited_until)
from public.sync_state legacy
where legacy.id = 'matter'
  and legacy.rate_limited_until is not null;
