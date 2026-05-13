-- Matter Stats MVP schema
-- Stores Matter library metadata, reading activity, annotations, daily rollups,
-- and sync bookkeeping in an upsert-friendly shape for dashboard queries.

create extension if not exists pgcrypto;

create table public.matter_items (
  id text primary key,
  title text,
  url text,
  source text,
  author text,
  content_type text,
  status text,
  word_count integer check (word_count is null or word_count >= 0),
  estimated_reading_time_minutes integer check (
    estimated_reading_time_minutes is null
    or estimated_reading_time_minutes >= 0
  ),
  progress numeric check (progress is null or (progress >= 0 and progress <= 1)),
  created_at_matter timestamptz,
  updated_at_matter timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.matter_items is
  'Matter library items keyed by stable Matter item IDs; stores metadata used for source, author, status, and item-level dashboard breakdowns.';

create table public.reading_sessions (
  id text primary key,
  item_id text not null references public.matter_items(id) on delete cascade,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  source_device text,
  words_estimated integer check (words_estimated is null or words_estimated >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reading_sessions_ended_after_started check (
    started_at is null
    or ended_at is null
    or ended_at >= started_at
  )
);

comment on table public.reading_sessions is
  'Individual Matter reading sessions keyed by stable Matter session IDs and linked to items for time, device, words, date, and item-level analytics.';

create table public.matter_tags (
  id text primary key,
  name text not null,
  created_at_matter timestamptz,
  updated_at_matter timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matter_tags_name_key unique (name)
);

comment on table public.matter_tags is
  'Matter tags keyed by stable Matter tag IDs; unique tag names support idempotent imports and tag filter views.';

create table public.item_tags (
  item_id text not null references public.matter_items(id) on delete cascade,
  tag_id text not null references public.matter_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, tag_id)
);

comment on table public.item_tags is
  'Join table linking Matter items to Matter tags with a composite primary key for upsert-friendly tag assignment syncs.';

create table public.annotations (
  id text primary key,
  item_id text not null references public.matter_items(id) on delete cascade,
  text text,
  note text,
  created_at_matter timestamptz,
  updated_at_matter timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.annotations is
  'Matter highlights and notes keyed by stable Matter annotation IDs and linked to items for highlight counts and annotation views.';

create table public.daily_stats (
  date date primary key,
  reading_time_seconds integer not null default 0 check (reading_time_seconds >= 0),
  words_read integer not null default 0 check (words_read >= 0),
  sessions_count integer not null default 0 check (sessions_count >= 0),
  items_read_count integer not null default 0 check (items_read_count >= 0),
  highlights_count integer not null default 0 check (highlights_count >= 0),
  top_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.daily_stats is
  'Pre-aggregated daily Matter reading metrics keyed by calendar date for fast dashboard trend and summary queries.';

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  items_synced integer not null default 0 check (items_synced >= 0),
  sessions_synced integer not null default 0 check (sessions_synced >= 0),
  error_message text,
  checkpoint_timestamp timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_runs_finished_after_started check (
    finished_at is null
    or finished_at >= started_at
  )
);

comment on table public.sync_runs is
  'Sync job audit log that records run status, counts, errors, and checkpoints for incremental Matter imports.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_matter_items_updated_at
before update on public.matter_items
for each row execute function public.set_updated_at();

create trigger set_reading_sessions_updated_at
before update on public.reading_sessions
for each row execute function public.set_updated_at();

create trigger set_matter_tags_updated_at
before update on public.matter_tags
for each row execute function public.set_updated_at();

create trigger set_annotations_updated_at
before update on public.annotations
for each row execute function public.set_updated_at();

create trigger set_daily_stats_updated_at
before update on public.daily_stats
for each row execute function public.set_updated_at();

create trigger set_sync_runs_updated_at
before update on public.sync_runs
for each row execute function public.set_updated_at();

create index matter_items_source_idx on public.matter_items (source);
create index matter_items_author_idx on public.matter_items (author);
create index matter_items_content_type_idx on public.matter_items (content_type);
create index matter_items_status_idx on public.matter_items (status);
create index matter_items_created_at_matter_idx on public.matter_items (created_at_matter);
create index matter_items_updated_at_matter_idx on public.matter_items (updated_at_matter);
create index matter_items_last_synced_at_idx on public.matter_items (last_synced_at);
create index matter_items_created_at_idx on public.matter_items (created_at);
create index matter_items_updated_at_idx on public.matter_items (updated_at);

create index reading_sessions_item_id_idx on public.reading_sessions (item_id);
create index reading_sessions_started_at_idx on public.reading_sessions (started_at);
create index reading_sessions_ended_at_idx on public.reading_sessions (ended_at);
create index reading_sessions_created_at_idx on public.reading_sessions (created_at);
create index reading_sessions_updated_at_idx on public.reading_sessions (updated_at);
create index reading_sessions_source_device_idx on public.reading_sessions (source_device);

create index matter_tags_name_idx on public.matter_tags (name);
create index matter_tags_created_at_matter_idx on public.matter_tags (created_at_matter);
create index matter_tags_updated_at_matter_idx on public.matter_tags (updated_at_matter);
create index matter_tags_created_at_idx on public.matter_tags (created_at);
create index matter_tags_updated_at_idx on public.matter_tags (updated_at);

create index item_tags_item_id_idx on public.item_tags (item_id);
create index item_tags_tag_id_idx on public.item_tags (tag_id);

create index annotations_item_id_idx on public.annotations (item_id);
create index annotations_created_at_matter_idx on public.annotations (created_at_matter);
create index annotations_updated_at_matter_idx on public.annotations (updated_at_matter);
create index annotations_created_at_idx on public.annotations (created_at);
create index annotations_updated_at_idx on public.annotations (updated_at);

create index daily_stats_top_source_idx on public.daily_stats (top_source);
create index daily_stats_created_at_idx on public.daily_stats (created_at);
create index daily_stats_updated_at_idx on public.daily_stats (updated_at);

create index sync_runs_started_at_idx on public.sync_runs (started_at);
create index sync_runs_finished_at_idx on public.sync_runs (finished_at);
create index sync_runs_status_idx on public.sync_runs (status);
create index sync_runs_checkpoint_timestamp_idx on public.sync_runs (checkpoint_timestamp);
create index sync_runs_created_at_idx on public.sync_runs (created_at);
create index sync_runs_updated_at_idx on public.sync_runs (updated_at);
