-- Track all entity counts imported by each Matter sync run so settings can
-- diagnose partial imports without exposing any environment variable values.

alter table public.sync_runs
  add column if not exists annotations_synced integer not null default 0 check (annotations_synced >= 0),
  add column if not exists tags_synced integer not null default 0 check (tags_synced >= 0);
