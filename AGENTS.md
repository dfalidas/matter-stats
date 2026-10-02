# Contributor guide

These instructions apply to the entire repository.

## Application contract

- Matter Stats is a private, single-user Next.js App Router application written in TypeScript. Supabase is accessed only on the server with its service-role key; do not add browser Supabase clients or `NEXT_PUBLIC_` copies of server configuration.
- Authentication uses an opaque `matter_stats_session` cookie whose SHA-256 hash is stored in `public.app_sessions`. Every data page and server action must call the server-side session guard. Middleware is an early redirect, not the authorization boundary.
- Keep `/api/cron/sync-recent-activity` outside cookie authentication. It accepts only `Authorization: Bearer <CRON_SECRET>` and must not accept a query-string secret.
- The analytics timezone comes from `APP_TIMEZONE` and defaults to `Europe/Athens`. Preserve explicit timezone handling when changing dates or reporting periods.
- Treat `matter_items.word_count` as nullable Matter metadata. Session word estimates currently use rounded `word_count * progress` when both values exist, otherwise rounded duration at 225 WPM; see `docs/architecture.md` before changing metric semantics.

## Working practices

- Install the exact lockfile with `npm ci`. Before submitting runtime changes, run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
- Run migrations in filename/timestamp order. In particular, `20260929000000_harden_rls_and_auth.sql` must precede `20260929010000_atomic_login_limiter.sql`, and both must be applied before code that calls `public.record_app_login_attempt` is deployed.
- Never commit real credentials, Supabase project/account identifiers, Matter data, or generated `.env.local` files.
- Do not infer production behavior from migrations or unit tests. Database grants/RLS, Data API access, RPC concurrency, migrations, and deployment state require evidence from an isolated or deployed environment.
- Keep documentation aligned with the routes, scripts, environment reads, `vercel.json`, and migration files in the same change.

## Change scope

- Keep runtime changes, database migrations, dependency updates, and documentation changes reviewable as separate concerns where practical.
- Do not run a real Matter sync, mutate production data, rotate secrets, or deploy without explicit authorization.
