-- W1/W3: keep the single-user application server-only and add revocable sessions.

create table if not exists public.app_sessions (
  token_hash text primary key check (length(token_hash) = 64),
  credential_version integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  constraint app_sessions_expiry_after_creation check (expires_at > created_at)
);

create index if not exists app_sessions_expires_at_idx on public.app_sessions (expires_at);

create table if not exists public.app_login_attempts (
  client_key_hash text not null check (length(client_key_hash) = 64),
  attempted_at timestamptz not null default now(),
  succeeded boolean not null default false
);

create index if not exists app_login_attempts_key_time_idx
  on public.app_login_attempts (client_key_hash, attempted_at desc);

comment on table public.app_sessions is
  'Hashed, revocable single-user application sessions. Raw bearer values are never stored.';
comment on table public.app_login_attempts is
  'Shared login-throttling records keyed by a one-way client identifier hash.';

-- This inventory is deliberately object-scoped: never revoke an entire shared schema.
alter table public.matter_items enable row level security;
alter table public.reading_sessions enable row level security;
alter table public.matter_tags enable row level security;
alter table public.item_tags enable row level security;
alter table public.annotations enable row level security;
alter table public.daily_stats enable row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_state enable row level security;
alter table public.app_sessions enable row level security;
alter table public.app_login_attempts enable row level security;

revoke all on table public.matter_items, public.reading_sessions, public.matter_tags,
  public.item_tags, public.annotations, public.daily_stats, public.sync_runs,
  public.sync_state, public.app_sessions, public.app_login_attempts
  from public, anon, authenticated;

-- Trigger functions are not application RPCs. Restrict direct execution while
-- retaining trigger invocation and the service role's administrative access.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

grant all on table public.matter_items, public.reading_sessions, public.matter_tags,
  public.item_tags, public.annotations, public.daily_stats, public.sync_runs,
  public.sync_state, public.app_sessions, public.app_login_attempts to service_role;
grant execute on function public.set_updated_at() to service_role;
