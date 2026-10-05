# Deployment guide: Vercel + Supabase

This guide describes the repository's deployment contract. It does not authorize a production deployment, secret rotation, real Matter sync, paid service change, or production database mutation.

## Prerequisites

- a Vercel project connected to the repository;
- an isolated or production Supabase project, as appropriate for the approved operation;
- a Matter API token; and
- the exact application commit and migration evidence recorded for the release.

Use `npm ci` for local/CI installation. Do not substitute guessed configuration or commit real secrets, account identifiers, or project identifiers.

## 1. Apply the database migrations

Apply every SQL file in `supabase/migrations` in filename/timestamp order:

1. `20260513000000_create_matter_stats_mvp_schema.sql`
2. `20260514000000_add_sync_run_annotation_tag_counts.sql`
3. `20260515000000_add_matter_sync_state.sql`
4. `20260515010000_add_sync_state_rate_limit.sql`
5. `20260515020000_add_recent_activity_sync_state.sql`
6. `20260515030000_add_sync_run_recent_activity_diagnostics.sql`
7. `20260518000000_add_reading_session_import_diagnostics.sql`
8. `20260519090000_allow_nullable_reading_session_item_id.sql`
9. `20260929000000_harden_rls_and_auth.sql`
10. `20260929010000_atomic_login_limiter.sql`
11. `20261004000000_add_independent_sync_stream_cycles.sql`
12. `20261004010000_preserve_sync_cooldown_and_window.sql`

The two `20260929` migrations must both succeed **before** deploying code that performs login. The first creates `public.app_sessions` and `public.app_login_attempts` and declares the table RLS/grant policy. The second defines:

```sql
public.record_app_login_attempt(
  p_client_key_hash text,
  p_succeeded boolean,
  p_limit integer default 5,
  p_window_seconds integer default 900
) returns boolean
```

The application invokes that RPC through `service_role`. Applying only the first migration leaves login without its required function.

Both Task 11 migrations must succeed before deploying the independent-stream runtime. The first adds `public.matter_sync_streams`, enables RLS, revokes browser roles, and grants only `service_role`. Because the singleton lacked a persisted page limit, it performs a recoverable restart: it copies no legacy cursor, infers no watermark, and changes no imported domain data. The follow-up records explicit session-window intent and carries any existing singleton `rate_limited_until` into both streams so the account-wide cooldown survives transition.

For an existing project, follow [the security release runbook](security-release-runbook.md) and verify both an upgrade path and a fresh migration chain in disposable environments before production. SQL text demonstrates intended controls, not deployed controls: retain separate evidence for applied migrations, browser-role Data API denial, service-role allowance, and 20-request RPC concurrency.

If using the Supabase CLI, link only to the deliberately selected project and review the target before running `supabase db push`. `supabase db reset --local` is appropriate for the fresh local check. Do not point destructive verification at production.

## 2. Configure server-side environment values

Copy `.env.example` only as a template. Replace its obvious placeholders in Vercel **Settings > Environment Variables** and in an uncommitted `.env.local` for local development.

| Variable | Requirement |
| --- | --- |
| `APP_ACCESS_PASSWORD` | Required secret used at `/login`. |
| `APP_CREDENTIAL_VERSION` | Positive integer; start at `1`. Incrementing invalidates older app sessions. |
| `APP_TIMEZONE` | Optional valid IANA timezone; code falls back to `Europe/Athens`. |
| `MATTER_API_TOKEN` | Required server-only Matter secret. |
| `SUPABASE_URL` | Required server-side Supabase URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required server-only administrative key. |
| `CRON_SECRET` | Required for authorized scheduled sync; use a long random secret. |
| `MATTER_SYNC_ITEMS_LIMIT` | Optional positive integer; defaults to `25`. |
| `MATTER_SYNC_SESSIONS_LIMIT` | Optional positive integer; defaults to `25`. |

None of these variables should be prefixed with `NEXT_PUBLIC_`. In particular, the service-role key bypasses normal RLS enforcement and must never reach browser code. Redeploy after changing Vercel environment values.

## 3. Check and deploy the application

From a clean checkout:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Keep Vercel's detected framework as Next.js and use `npm run build`. Deploy only after the required migrations and configuration are present. The application renders data pages dynamically; build success does not verify Supabase, Matter, environment values, or deployed data.

## 4. Configure scheduled sync

`vercel.json` already defines this daily schedule:

```text
0 6 * * * UTC
```

It calls `GET /api/cron/sync-recent-activity`. Authorization is exclusively:

```http
Authorization: Bearer <CRON_SECRET>
```

A missing or incorrect Bearer value receives HTTP 401. There is no supported query-string secret. This endpoint performs bounded recent-activity sync and may skip work while the stored Matter rate limit is active. It does not guarantee full backfill, exhaustive continuation, or concurrent-invocation safety; those remain stabilization work.

## 5. Verify the deployed release

After deployment, record sanitized evidence rather than assuming implementation equals production behavior:

1. Record the deployed Git SHA and migration identifiers.
2. Open `/login`, verify a failed login is rejected, then verify a valid login reaches `/dashboard`.
   In an isolated environment, also make the limiter RPC and session storage unavailable in turn: login must show the generic retryable outage message without setting a cookie or redirecting, and server logs must contain only the sanitized login operation/reason identifiers.
3. Confirm **Overview**, **Activity**, **Library**, and **Reports** load. On mobile, confirm **Account** exposes Settings and Log out. Check `/settings` and any retained legacy route required by the release (`/sources`, `/authors`, `/tags`, `/year-in-reading`).
4. Log out and confirm the old session cannot be replayed.
5. Test cron with missing, wrong, and correct Bearer values without using a query parameter. Run a real Matter sync only when separately authorized.
6. Execute the runbook's isolated Data API/RPC checks and retain sanitized results. Run the read-only audit and Supabase Security Advisor as approved.

Observed Matter sessions may have a null item link. That supports time and session metrics but makes source/author/tag/article attribution incomplete; it is not evidence that a later sync will repair attribution. Estimated word semantics and other open metric consistency work are documented in [architecture.md](architecture.md).

## 6. Secret rotation and rollback

Changing `APP_ACCESS_PASSWORD` should be paired with incrementing `APP_CREDENTIAL_VERSION` so previously issued database-backed sessions fail validation. Rotate Matter, cron, and Supabase credentials according to their providers' procedures and only with operational approval. A configuration change requires redeployment.

For Task 11 runtime rollback, deploy the prior application first; it continues using retained `sync_state`. The additive `matter_sync_streams` table may remain. Dropping it discards only cycle/retry metadata (not imported Matter data) and requires an approved destructive migration. Do not disable RLS or delete imported rows as rollback.

## Open work and external verification

Security dependency patching, reliable sync continuation/concurrency, complete database queries, streak/word/timezone consistency, repair tooling, and CI are not completed by the interface redesign. Production compatibility, actual migration state, Data API permissions, RPC concurrency, cron delivery, live Matter payloads, stored-data correctness, and the deployed SHA remain externally verified facts, not repository guarantees.
