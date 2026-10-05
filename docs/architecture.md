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

### Analytics comparison windows

Reports use complete local calendar periods and compare them with the immediately preceding period of the same identity: day, Monday-based week, month, or year. Historical reports are never clipped to the current clock. Overview presets are period-to-date: one request-scoped `now` closes the current window, and the comparison closes at the same local calendar position and wall-clock time in the preceding day, week, month, or year. Custom Overview dates remain complete inclusive user dates (represented by an exclusive midnight boundary) and compare with the immediately preceding equal-length local-calendar span. All-time has no comparison.

Month/year comparisons clamp a missing corresponding day to the target month's last valid day while retaining the local clock time; they never overflow into the next month or beyond that period's exclusive end. Local times in a daylight-saving gap advance by the transition gap, while repeated local times select the earlier instant. These deterministic rules match JavaScript/Temporal `compatible` disambiguation. Every query uses half-open bounds (`start <= started_at < end`), and heatmaps include an ending calendar day when the exclusive end is intraday but exclude that day when the end is local midnight.

An Overview request made exactly at the local start of its selected preset has an empty period-to-date window: its heatmap has no day buckets and its range copy displays that boundary as an `As of` date rather than an inverted range.

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

## Matter sync stream cycles

Matter pagination is persisted independently in `public.matter_sync_streams` for `recent_sessions` (`GET /reading_sessions`) and `library_items` (`GET /items`). Manual and scheduled activity syncs are only different triggers for the same `recent_sessions` stream. Each active cycle pins its endpoint, exact documented filters/lower bound, page limit, opaque cursor, start time, and cycle generation; later invocations resume that contract even across a year boundary or environment limit change. Cycle generation identifies a logical cycle and is not the Task 12 lease/fencing generation.

Matter cooldowns are account-wide: availability checks and every sync invocation use the latest active retry timestamp across both streams and the retained legacy singleton before any cycle write or upstream call. An explicit manual history-window selection is also durable. Repeating that same selection resumes the pinned contract without recomputing its rolling boundary; requesting a different window is rejected without changing state or calling Matter. Scheduled triggers do not change the stored history intent.

The first sessions cycle uses the explicitly selected coverage lower bound. A genuinely exhausted cycle promotes its captured start time to the completed watermark, including when the final page is empty. Partial and failed cycles do not promote it. Later cycles replay from seven days before that watermark using inclusive `since`; this is an application overlap policy for idempotent upserts, not a Matter late-arrival or cursor-snapshot guarantee. Imported minimum/maximum timestamps do not establish historical completeness. Library enumeration uses only documented parameters and remains independent of session import.

The legacy singleton did not persist its page limit, so a complete active request contract cannot be reconstructed. Migration creates both streams with a `legacy_recoverable_restart` marker, no cursor, and no claimed completed watermark. Existing imported domain rows are preserved.

## Database and release order

Apply every file in `supabase/migrations` in timestamp order. The login schema specifically requires:

1. `20260929000000_harden_rls_and_auth.sql` creates `public.app_sessions` and `public.app_login_attempts`, enables RLS on the application table inventory, removes browser-role table access, and grants the service role.
2. `20260929010000_atomic_login_limiter.sql` creates the function `public.record_app_login_attempt(p_client_key_hash text, p_succeeded boolean, p_limit integer default 5, p_window_seconds integer default 900) returns boolean`, revokes browser-role execution, and grants execution to `service_role`.
3. Only after both migrations succeed should application code that calls that RPC be deployed.
4. `20261004000000_add_independent_sync_stream_cycles.sql` adds the protected stream-cycle rows and must precede Task 11 runtime code.
5. `20261004010000_preserve_sync_cooldown_and_window.sql` preserves the legacy account cooldown and adds explicit session-window intent; it must also precede Task 11 runtime code.

The SQL expresses the intended RLS and grant policy, and the TypeScript implements service-role-only access. That is not evidence that production has applied the migrations. Fresh and upgrade migration runs, Data API denial for `anon`/`authenticated`, service-role allowance, and the RPC's behavior under real concurrent database calls must be verified separately in an isolated Supabase environment. Unit-test mocks do not establish those properties.

## Metrics and known boundaries

- Estimated words use the fixed formula `Math.round(duration_seconds / 60 * 225)` for each valid session. Totals sum those integer session estimates; they never round a day, item, group, or period's combined duration.
- `matter_items.word_count` is nullable upstream metadata, not a measured reading total. Item reading-time metadata is derived from it when present.
- Session normalization and normal future writes persist the duration-based estimate. Production reads independently derive the same value from session duration, so missing or bogus legacy `words_estimated`, item word counts, progress, and missing item links do not change analytics.
- Existing historical `reading_sessions.words_estimated` and `daily_stats.words_read` rows may remain stale until the repair/rebuild work in Tasks 19–20. This change does not backfill or rewrite them; normal future session and daily-rollup writes are canonical, and current application reporting calculates from sessions.
- Matter session payloads may lack a usable item identifier. Those sessions can be stored with a null `item_id`, so time/session totals can remain available while source, author, tag, article counts, and other attribution-dependent breakdowns are incomplete. Missing attribution is an unsupported capability with the observed payload—not a promise that another sync will repair it.
- Analytics calendar behavior uses the validated `APP_TIMEZONE`, defaulting to `Europe/Athens`. Raw timestamps stay UTC; session, annotation, activity, report, and new daily-rollup windows use local calendar boundaries converted to UTC with half-open `[start, end)` queries. Reading sessions are attributed wholly to their start date. Current reading streaks are anchored to one request-scoped current time and may carry through an empty today only when yesterday is active; reports expose their selected-date streak separately.
- Legacy `daily_stats` rows may still reflect the former UTC-day buckets until the authorized repair/rebuild work in Tasks 19–20. Latest-week discovery therefore uses raw reading-session timestamps rather than treating those historical rollups as authoritative. This release does not recalculate, backfill, or otherwise repair production history.

## Remaining stabilization work

The merged interface redesign does not complete the stabilization plan. Remaining work includes:

- review official advisories and apply the smallest supported security dependency patches;
- reliable sync continuation, leases/concurrency control, and large-history behavior;
- complete/paginated database queries rather than implicit Data API result limits;
- historical timezone rollup repair and reconciliation;
- repair/rebuild tooling for derived data and interrupted sync state; and
- CI coverage, including isolated database authorization and migration checks.

## Verification boundaries

Repository inspection can confirm code, migration text, and deterministic local checks. It cannot by itself confirm the deployed commit, environment values, migration history, production RLS/grants, Supabase Security Advisor state, live Matter response shapes, actual RPC concurrency, cron delivery, or stored-data correctness. Record those as external verification evidence rather than marking them complete from implementation alone.
