-- Split Matter sync bookkeeping so recent activity sync can proceed separately
-- from optional full-library backfill cursor state.

alter table public.sync_state
  add column if not exists sync_mode text not null default 'recent_activity' check (sync_mode in ('recent_activity', 'backfill_library')),
  add column if not exists recent_activity_checkpoint timestamptz,
  add column if not exists backfill_items_cursor text;

comment on column public.sync_state.sync_mode is
  'The last Matter sync mode that updated this singleton state: recent activity or optional library backfill.';

comment on column public.sync_state.recent_activity_checkpoint is
  'Latest reading-session timestamp safely imported by recent activity sync.';

comment on column public.sync_state.backfill_items_cursor is
  'Matter item-list cursor for optional bounded library backfill batches.';

create index if not exists sync_state_sync_mode_idx on public.sync_state (sync_mode);
create index if not exists sync_state_recent_activity_checkpoint_idx on public.sync_state (recent_activity_checkpoint);
