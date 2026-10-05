-- Task 11: durable, independent Matter endpoint cycles.  The old singleton is
-- retained for rolling compatibility and diagnostics, but new code writes only
-- this table.  No imported Matter rows are changed or deleted by this migration.

create table public.matter_sync_streams (
  stream text primary key check (stream in ('recent_sessions', 'library_items')),
  endpoint text not null check (endpoint in ('/reading_sessions', '/items')),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  page_limit integer not null check (page_limit between 1 and 100),
  cursor text,
  cycle_started_at timestamptz,
  cycle_generation bigint not null default 0 check (cycle_generation >= 0),
  completed_watermark timestamptz,
  retry_at timestamptz,
  cycle_active boolean not null default false,
  transition_status text not null default 'native'
    check (transition_status in ('native', 'legacy_recoverable_restart')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matter_sync_stream_active_contract check (
    (cycle_active and cycle_started_at is not null) or
    (not cycle_active and cursor is null and cycle_started_at is null)
  )
);

comment on table public.matter_sync_streams is
  'Independent durable Matter endpoint cycles. cycle_generation is cycle identity, not a lease/fencing token.';
comment on column public.matter_sync_streams.filters is
  'Exact documented endpoint query parameters excluding limit and cursor; reused unchanged while a cycle is active.';
comment on column public.matter_sync_streams.completed_watermark is
  'Cycle-start watermark from the last genuinely exhausted cycle; never inferred from imported timestamps.';
comment on column public.matter_sync_streams.transition_status is
  'Legacy singleton cursors cannot be reconstructed because their page limit was not persisted; restart is recoverable and preserves imported rows.';

create trigger set_matter_sync_streams_updated_at
before update on public.matter_sync_streams
for each row execute function public.set_updated_at();

alter table public.matter_sync_streams enable row level security;
revoke all on table public.matter_sync_streams from public, anon, authenticated;
grant all on table public.matter_sync_streams to service_role;

-- The singleton did not persist a complete cursor contract (notably the page
-- limit), and its checkpoints were derived from imported timestamps.  Therefore
-- do not migrate cursors or claim coverage.  Imported domain data remains intact.
insert into public.matter_sync_streams
  (stream, endpoint, filters, page_limit, transition_status)
values
  ('recent_sessions', '/reading_sessions', '{}'::jsonb, 25, 'legacy_recoverable_restart'),
  ('library_items', '/items', '{"status":"all","order":"updated"}'::jsonb, 25, 'legacy_recoverable_restart')
on conflict (stream) do nothing;
