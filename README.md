# Matter Stats

Matter Stats is a private, single-user reading analytics dashboard for a Matter account. It uses the Next.js App Router, TypeScript, Tailwind CSS, server-side Supabase access, and server-side Matter sync. See [the architecture and application contract](docs/architecture.md) for implementation details and verification boundaries.

## Navigation and routes

The current primary navigation is:

- **Overview** (`/dashboard`) — summary metrics, periods, library preview, and manual sync.
- **Activity** (`/activity`) — day-level reading activity.
- **Library** (`/articles`) — searchable library; item details are at `/articles/[id]`.
- **Reports** (`/reports`) — weekly, monthly, yearly, and custom-period reporting.

Desktop navigation includes **Settings** (`/settings`) and Log out. On mobile they are under the **Account** menu. Existing `/sources`, `/authors`, `/tags`, and `/year-in-reading` routes remain available as legacy analytics views but are not primary navigation. `/` redirects to `/dashboard`, and `/login` is the public password form.

## Security model

- Login creates an opaque `matter_stats_session` token. Only its hash and lifecycle metadata are stored in Supabase; protected pages and dashboard actions validate it server-side. Middleware provides an additional early redirect using an explicit public-path allowlist.
- Matter, Supabase service-role, password, and cron secrets stay server-side. Do not create `NEXT_PUBLIC_` versions. The browser does not need a Supabase key.
- The scheduled endpoint `/api/cron/sync-recent-activity` is separate from cookie authentication and accepts only `Authorization: Bearer <CRON_SECRET>`.
- Migrations implement RLS and browser-role restrictions, but production migration state, Data API denial/allowance, and real RPC concurrency require external evidence; repository code and unit tests do not prove deployed behavior.

## Environment variables

Copy `.env.example` to `.env.local` and replace every placeholder locally. Configure the same server-side values in the deployment environment.

| Variable | Purpose |
| --- | --- |
| `APP_ACCESS_PASSWORD` | Required shared login password; secret. |
| `APP_CREDENTIAL_VERSION` | Positive session credential version. Keep `1` initially; increment to invalidate older sessions after password rotation. |
| `APP_TIMEZONE` | Optional IANA analytics timezone; defaults to `Europe/Athens`. |
| `MATTER_API_TOKEN` | Required Matter API secret. |
| `SUPABASE_URL` | Required server-side Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required server-only administrative key. |
| `CRON_SECRET` | Bearer secret required by scheduled sync. |
| `MATTER_SYNC_ITEMS_LIMIT` | Optional positive item page limit; defaults to `25`. |
| `MATTER_SYNC_SESSIONS_LIMIT` | Optional positive session page limit; defaults to `25`. |

## Local development

Use the checked-in lockfile:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000/login>. Never commit `.env.local` or real project/account identifiers.

## Database setup

Apply all files in `supabase/migrations` in timestamp order. Authentication has a strict release dependency:

1. `20260929000000_harden_rls_and_auth.sql`
2. `20260929010000_atomic_login_limiter.sql`
3. application deployment

The second migration defines `public.record_app_login_attempt(text, boolean, integer, integer) returns boolean`; the login action calls it, so deploying the application first breaks login. See the [deployment guide](docs/deployment.md) and [security runbook](docs/security-release-runbook.md).

## Metric boundaries

Estimated words use 225 WPM when item facts are unavailable. Matter `word_count` is nullable library metadata. Current normalization instead copies rounded `word_count * progress` into a session when both fields exist; this differs from the still-open target of additive per-session duration rounding and can over-count repeated sessions.

Reading sessions without an item identifier retain time/session metrics but cannot support reliable source, author, tag, or article attribution. Another sync is not guaranteed to add an identifier that Matter did not provide.

## Scheduled sync

Vercel is configured in `vercel.json` to call `/api/cron/sync-recent-activity` daily at `0 6 * * *` UTC. The endpoint runs bounded recent-activity sync, not a full-library backfill. Reliable continuation and concurrency control remain stabilization work.

## Checks

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Use `npm ci` before checks in a clean environment. `npm run test:security-db` is a separate destructive-capable integration check and must only target an acknowledged disposable Supabase environment as described in the security runbook.

## Remaining work

The interface redesign is complete, but security dependency patching, reliable sync continuation/concurrency, complete database queries, streak/word/timezone consistency, repair tooling, and CI remain open. Do not infer their completion from the redesigned navigation.
