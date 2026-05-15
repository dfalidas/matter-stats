-- Store safe recent-activity sync diagnostics for Settings without exposing tokens.

alter table public.sync_runs
  add column if not exists sync_mode text not null default 'recent_activity' check (sync_mode in ('recent_activity', 'backfill_library')),
  add column if not exists matter_requests_count integer not null default 0 check (matter_requests_count >= 0),
  add column if not exists matter_sessions_returned integer not null default 0 check (matter_sessions_returned >= 0),
  add column if not exists matter_items_returned integer not null default 0 check (matter_items_returned >= 0),
  add column if not exists matter_has_more boolean,
  add column if not exists matter_next_cursor_present boolean;

comment on column public.sync_runs.sync_mode is
  'Safe sync mode label for the run: recent_activity or backfill_library.';
comment on column public.sync_runs.matter_requests_count is
  'Count of Matter API requests attempted during the run; excludes credentials and request headers.';
comment on column public.sync_runs.matter_sessions_returned is
  'Count of reading session objects returned by Matter during the run before local normalization.';
comment on column public.sync_runs.matter_items_returned is
  'Count of item objects returned by Matter during the run before local normalization.';
comment on column public.sync_runs.matter_has_more is
  'The last Matter list response has_more value observed during the run.';
comment on column public.sync_runs.matter_next_cursor_present is
  'Whether the last Matter list response included a non-empty next_cursor; the cursor value is stored only in sync_state.';

create index if not exists sync_runs_sync_mode_idx on public.sync_runs (sync_mode);
