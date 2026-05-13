# Matter Stats

A private, single-user Matter reading analytics dashboard built with Next.js App Router, TypeScript, Tailwind CSS, Recharts, and Supabase PostgreSQL.

## Phase 1 scope

- Dark-first dashboard shell with core routes.
- HTTP-only cookie app-password gate using `APP_ACCESS_PASSWORD`.
- Server-only Matter and Supabase credential modules.
- Typed data models for articles, sessions, highlights, and dashboard summaries.
- Manual sync API route scaffold with an incremental cursor-shaped result.
- Supabase schema starter in `supabase/schema.sql`.

## Local setup

1. Copy `.env.example` to `.env.local` and fill in the server-side values.
2. Apply `supabase/schema.sql` to your Supabase project.
3. Install dependencies and run the app:

```bash
npm install
npm run dev
```

## Security notes

- `MATTER_API_TOKEN` is only read from server-only modules.
- `SUPABASE_SERVICE_ROLE_KEY` is only read from server-only modules.
- Browser routes are protected by an HTTP-only cookie set after the app password succeeds.
