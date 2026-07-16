-- Persist Matter API cursor checkpoints so Vercel manual syncs can continue in
-- bounded batches instead of importing the whole library in one request.

create table if not exists public.sync_state (
  id text primary key default 'matter' check (id = 'matter'),
  completed_checkpoint_timestamp timestamptz,
  active_since_timestamp timestamptz,
  active_phase text not null default 'complete' check (active_phase in ('items', 'tags', 'sessions', 'complete')),
  item_cursor text,
  tag_cursor text,
  session_cursor text,
  next_checkpoint_timestamp timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sync_state is
  'Singleton Matter sync cursor state used to continue bounded Vercel-safe sync batches across manual sync clicks.';

create trigger set_sync_state_updated_at
before update on public.sync_state
for each row execute function public.set_updated_at();

create index if not exists sync_state_active_phase_idx on public.sync_state (active_phase);
create index if not exists sync_state_completed_checkpoint_timestamp_idx on public.sync_state (completed_checkpoint_timestamp);
