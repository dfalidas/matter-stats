-- Allow importing reading sessions when Matter does not provide a linked item ID.
alter table public.reading_sessions
  alter column item_id drop not null;

comment on column public.reading_sessions.item_id is
  'Nullable Matter item reference for a reading session. Sessions can be imported without item metadata and enriched later.';

alter table public.sync_runs
  add column if not exists matter_sessions_without_linked_item integer not null default 0 check (matter_sessions_without_linked_item >= 0);

comment on column public.sync_runs.matter_sessions_without_linked_item is
  'Count of imported Matter reading sessions without a resolvable linked item ID.';
