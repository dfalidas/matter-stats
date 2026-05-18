-- Store safe reading-session import diagnostics without Matter tokens, titles, URLs, or content.

alter table public.sync_runs
  add column if not exists matter_sessions_skipped integer not null default 0 check (matter_sessions_skipped >= 0),
  add column if not exists matter_first_session_shape jsonb;

comment on column public.sync_runs.matter_sessions_skipped is
  'Count of Matter reading sessions returned during the run that were skipped because required import fields were missing.';
comment on column public.sync_runs.matter_first_session_shape is
  'Safe metadata for the first returned reading-session object: keys and booleans only; no titles, URLs, content, headers, or tokens.';
