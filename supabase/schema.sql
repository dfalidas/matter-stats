create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  matter_id text not null unique,
  title text not null,
  url text not null,
  source text,
  author text,
  word_count integer default 0,
  reading_time_minutes integer default 0,
  status text not null default 'queued',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  tags text[] default '{}'
);

create table if not exists public.reading_sessions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_minutes integer not null,
  words_read integer not null default 0
);

create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  text text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.sync_state (
  id text primary key,
  provider text not null,
  cursor text,
  last_synced_at timestamptz,
  metadata jsonb
);

create index if not exists articles_read_at_idx on public.articles(read_at desc);
create index if not exists articles_source_idx on public.articles(source);
create index if not exists articles_author_idx on public.articles(author);
create index if not exists reading_sessions_started_at_idx on public.reading_sessions(started_at desc);
create index if not exists highlights_created_at_idx on public.highlights(created_at desc);
