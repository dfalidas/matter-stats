# Architecture and application contract

This documentation refresh inspected implementation baseline `6648b5d240719998ac0fd0fe29c47e28d224a496`; the local baseline exactly matched the reviewed commit, so there were no later application commits to reconcile. This document describes the resulting repository contract, not proof that a production database or deployment matches it.

## System shape

Matter Stats is a private, single-user reading analytics application:

- **Web application:** Next.js App Router and React, written in TypeScript and styled with Tailwind CSS.
- **Hosting contract:** Vercel runs dynamic server components, server actions, middleware, and the scheduled route. `vercel.json` schedules recent-activity sync at `0 6 * * *` UTC each day.
- **Persistence:** server-side Supabase JS calls the Supabase Data API with `SUPABASE_URL` and the service-role key. The browser has no Supabase client or key.
- **Upstream data:** server-side sync code calls Matter with `MATTER_API_TOKEN`, normalizes library metadata and reading sessions, and writes them through Supabase.

`APP_ACCESS_PASSWORD`, `MATTER_API_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` are secrets. `SUPABASE_URL`, `APP_CREDENTIAL_VERSION`, `APP_TIMEZONE`, and the sync limits are also server-side configuration in this application. None should use a `NEXT_PUBLIC_` prefix.

## Authentication and authorization

Login compares the submitted shared password in constant time, then calls `public.record_app_login_attempt` through the service role. A successful login creates a random opaque token. Only its SHA-256 hash, credential version, creation time, expiry, and revocation state are stored in `public.app_sessions`; the raw token is placed in the HTTP-only, same-site `matter_stats_session` cookie. Sessions have a 30-day server-side expiry and can be revoked at logout. Raising `APP_CREDENTIAL_VERSION` invalidates sessions created under older versions.

Login fails closed when the limiter RPC, session table, Data API, or network is unavailable: the form receives a generic retryable message and no session cookie or dashboard redirect. Server diagnostics are limited to allowlisted operation and reason identifiers rather than raw database errors or request credentials. Incorrect-password and rate-limit messages remain distinct. Session validation likewise denies access when storage returns an error or rejects its operation.

Authorization has two layers:

1. `middleware.ts` permits `/login`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, `/icon.svg`, Next.js assets, and `/api/cron/*` without the app session. For other paths it validates the database-backed session and redirects failures to `/login`. This is an early user-experience redirect.
2. Protected server pages call `requireAccessSession`, and protected dashboard server actions independently validate the session before accessing data or syncing. These page/action checks are the mandatory authorization boundary; middleware alone is not sufficient.

The cron route is intentionally outside cookie authentication. `GET /api/cron/sync-recent-activity` accepts only an exact `Authorization: Bearer <CRON_SECRET>` value. It does not accept a query parameter. It performs the bounded recent-activity sync and honors the stored Matter rate-limit state; it does not promise a full library backfill or reliable continuation across every invocation.

## Routes and navigation

The current primary navigation is **Overview** (`/dashboard`), **Activity** (`/activity`), **Library** (`/articles`), and **Reports** (`/reports`). Desktop navigation also links Settings and Log out. On mobile, Settings and Log out are in the **Account** menu while the four primary destinations remain in the bottom navigation.

Other implemented routes are:

- `/` redirects to `/dashboard`; `/login` is the public password form.
- `/articles/[id]` shows a library item.
- `/settings` provides sync/data diagnostics.
- `/sources`, `/authors`, `/tags`, and `/year-in-reading` are retained legacy analytics routes even though they are not in primary navigation.

All application/data routes above except `/login` require an app session.

## Environment contract

| Variable | Required by current code | Meaning |
| --- | --- | --- |
| `APP_ACCESS_PASSWORD` | Yes | Shared login password; server-only secret. |
| `APP_CREDENTIAL_VERSION` | Operationally required; code defaults to `1` | Positive integer stored with sessions. Increment after password rotation to revoke older sessions. |
| `APP_TIMEZONE` | Optional | IANA timezone for analytics; invalid/missing values fall back to `Europe/Athens`. |
| `MATTER_API_TOKEN` | Yes for Matter operations | Server-only Matter API secret. |
| `SUPABASE_URL` | Yes | Server-side Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only administrative key; can bypass RLS. |
| `CRON_SECRET` | Required for scheduled sync | Server-only Bearer secret; a missing value makes cron authorization fail closed. |
| `MATTER_SYNC_ITEMS_LIMIT` | Optional | Positive per-request item page limit; defaults to `25`. |
| `MATTER_SYNC_SESSIONS_LIMIT` | Optional | Positive per-request session page limit; defaults to `25`. |

## Database and release order

Apply every file in `supabase/migrations` in timestamp order. The login schema specifically requires:

1. `20260929000000_harden_rls_and_auth.sql` creates `public.app_sessions` and `public.app_login_attempts`, enables RLS on the application table inventory, removes browser-role table access, and grants the service role.
2. `20260929010000_atomic_login_limiter.sql` creates the function `public.record_app_login_attempt(p_client_key_hash text, p_succeeded boolean, p_limit integer default 5, p_window_seconds integer default 900) returns boolean`, revokes browser-role execution, and grants execution to `service_role`.
3. Only after both migrations succeed should application code that calls that RPC be deployed.

The SQL expresses the intended RLS and grant policy, and the TypeScript implements service-role-only access. That is not evidence that production has applied the migrations. Fresh and upgrade migration runs, Data API denial for `anon`/`authenticated`, service-role allowance, and the RPC's behavior under real concurrent database calls must be verified separately in an isolated Supabase environment. Unit-test mocks do not establish those properties.

## Metrics and known boundaries

- Time-derived words are estimates at **225 words per minute**, rounded to an integer.
- `matter_items.word_count` is nullable upstream metadata, not a measured reading total. Item reading-time metadata is derived from it when present.
- Current session normalization uses `round(item.word_count * item.progress)` for each session when both item fields are available; otherwise it uses `round(duration_seconds / 60 * 225)`. Reusing cumulative item progress for every session can over-count across multiple sessions.
- The target policy recorded by stabilization work is additive per-session duration estimation and rounding (for example, three 60-second sessions total 675 words at 225 WPM). That target is **not implemented** where the item metadata branch applies.
- Matter session payloads may lack a usable item identifier. Those sessions can be stored with a null `item_id`, so time/session totals can remain available while source, author, tag, article counts, and other attribution-dependent breakdowns are incomplete. Missing attribution is an unsupported capability with the observed payload—not a promise that another sync will repair it.
- Timezone behavior defaults to `Europe/Athens`. Current reading streaks use positive-duration sessions on local calendar dates, are anchored to one request-scoped current time rather than the selected report range, and may carry through an empty today only when yesterday is active. Reports expose their selected-date streak separately. Broader word and timezone consistency remains open; do not describe all aggregates as reconciled.

## Remaining stabilization work

The merged interface redesign does not complete the stabilization plan. Remaining work includes:

- review official advisories and apply the smallest supported security dependency patches;
- reliable sync continuation, leases/concurrency control, and large-history behavior;
- complete/paginated database queries rather than implicit Data API result limits;
- consistent word-estimation and broader timezone semantics outside reading streaks;
- repair/rebuild tooling for derived data and interrupted sync state; and
- CI coverage, including isolated database authorization and migration checks.

## Verification boundaries

Repository inspection can confirm code, migration text, and deterministic local checks. It cannot by itself confirm the deployed commit, environment values, migration history, production RLS/grants, Supabase Security Advisor state, live Matter response shapes, actual RPC concurrency, cron delivery, or stored-data correctness. Record those as external verification evidence rather than marking them complete from implementation alone.
