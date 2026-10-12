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
13. `20261005000000_matter_account_lease_fencing.sql`
14. `20261007085051_atomic_matter_page_commit.sql`
15. `20261007132750_matter_continuation_history_intent.sql`
16. `20261007145024_bound_account_cooldown_update.sql`
17. `20261008095102_matter_shared_quota_retry_preparation.sql`

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
| `MATTER_SYNC_ITEMS_LIMIT` | Optional integer 1–100; defaults to `25`. |
| `MATTER_SYNC_SESSIONS_LIMIT` | Optional integer 1–100; defaults to `25`. |

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

A missing or incorrect Bearer value receives HTTP 401. There is no supported query-string secret. This endpoint performs bounded recent-activity sync and may skip work while the stored Matter rate limit is active. The Task 12 runtime excludes concurrent sync invocations through the database account lease. Busy/cooldown invocations return HTTP 200 with `status=skipped` and no Matter calls or stream/run writes. Full backfill and exhaustive continuation remain separate work.

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

After Task 12, a rollback to any unfenced Task 11/earlier runtime requires the disable/drain sequence below; never simply run old and new sync versions together. The older runtime can use retained `sync_state`. The additive `matter_sync_streams` table may remain. Dropping it discards only cycle/retry metadata (not imported Matter data) and requires an approved destructive migration. Do not disable RLS or delete imported rows as rollback.

## Open work and external verification

Security dependency patching, reliable sync continuation/concurrency, complete database queries, streak/word/timezone consistency, repair tooling, and CI are not completed by the interface redesign. Production compatibility, actual migration state, Data API permissions, RPC concurrency, cron delivery, live Matter payloads, stored-data correctness, and the deployed SHA remain externally verified facts, not repository guarantees.

## Task 12 rollout and rollback compatibility

The Task 12 additive migration preserves imported rows, durations/timestamps,
stream request contracts/cursors, cycle generations, watermarks and cooldowns.
It creates one `matter` lease row at generation 0 and 14 service-only RPCs/helpers.
The runtime uses a fixed 120-second TTL; SQL allows validated 30–300 seconds.
No environment variables, dependencies, authentication providers or cron cadence
change. Do not delete/recreate/truncate the lease row or reset generation.

For an authorized rollout, first disable sync ingress on **every** old deployment
and invocation source: pause cron delivery at the hosting layer, restrict access
to the cron URL, and block manual sync actions/old deployment URLs (including
previews and local jobs) using deployment protection or an operational access
block. This is a temporary operational stop, not a change to the daily schedule.
Drain in-flight old executions and verify that none remain. If they cannot be
reliably drained, keep ingress disabled and stop the old deployment/jobs. Merely
waiting one lease TTL does not drain old code, which never acquired a lease.

Apply all migrations in order, ending with
`20261005000000_matter_account_lease_fencing.sql`. Verify the catalog and both
fresh/upgrade disposable SQL/Data API/runtime suites, then deploy the reviewed
fenced runtime with ingress still disabled. Confirm all sync writers use it
before re-enabling manual actions and the existing `0 6 * * *` UTC cron. Keep old
unfenced deployment URLs/jobs unable to sync. The migration alone leaves the
service role's existing domain-table privileges intact and **does not fence old
ordinary Supabase writes**. Its new lease/RPC objects protect cooperating Task 12
writers; old code must not run concurrently.

For code rollback, disable all sync ingress again, drain/stop the fenced runtime,
and verify no worker remains. Unexpired fenced leases may be compare-released by
their owner or allowed to expire. If rolling back to an unfenced version, ensure
that no fenced writer can resume before enabling old sync ingress. Leave the
additive migration, RLS and generation history in place. Prefer rolling forward;
never disable RLS or delete rows to recover. Removing the migration would require
a separately reviewed destructive change and is not a rollback step here.

A failed lease RPC or a missing migration fails closed: no fallback table write
or Matter request is made. A slow request may outlast the TTL and be discarded;
an abandoned run may retain `running` status. Task 13's page/marker transaction,
and Tasks 14–15 continuation/backfill/shared-quota work, remain separate release
work. Neither a successful build nor mock tests establish real database fencing.

## Task 13 release order and rollback

Apply `20261007085051_atomic_matter_page_commit.sql` after the Task 12 lease
migration and **before** deploying Task 13 code. It adds receipt/dirty-work tables
and page/recovery RPCs without rewriting existing domain rows, active Task 11
contracts/cursors/coverage/cooldowns or Task 12 owners/expiry/generations. No new
configuration, secret, dependency or cron cadence is required.

For a separately authorized production rollout:

1. Disable all sync ingress, including cron, manual actions, old deployment and
   preview URLs, local/background jobs. Drain or stop every old writer. Task 12
   writers are fenced per mutation but can still partially import pages and move
   checkpoints without dirty work; they must not run with Task 13 writers.
2. Retain a backup and the reviewed SHA/migration inventory. Apply the additive
   migration in order. Verify service-only object grants/RLS and function catalog.
   Both disposable fresh/upgrade runtime gates and existing dependency/audit policy
   must pass before enabling sync. See task-13-validation.md for current results.
3. Deploy the reviewed Task 13 runtime while ingress stays disabled. Ensure all
   writers use it, then re-enable existing manual/cron triggers. Keep old writers
   and previews blocked. Pending markers recover under normal leased invocations;
   no real Matter sync or historical rebuild is part of this implementation.

Prefer rolling code forward. To roll code back, disable/drain Task 13 writers
again and leave the additive schema, stream checkpoints, receipts, dirty work and
lease generation history intact. A read-only/non-sync rollback can safely leave
pending work for a later compatible runtime. Task 12 or older sync code does not
consume markers or honor the atomic page boundary: keep its sync ingress disabled
until a compatible recovery/commit runtime is restored. Do not drop marker/receipt
tables, reset cursors/generations/coverage, clear pending work, disable RLS, or
replay from a client-assumed checkpoint as a rollback. Production execution and
any destructive recovery require separate authorization.

## Task 14 release order and rollback

Apply `20261007132750_matter_continuation_history_intent.sql` after Task 13, then
`20261007145024_bound_account_cooldown_update.sql`, before Task 14 code. The
Supabase CLI generated both filenames. The intent migration adds one RLS
singleton, four fenced invoker RPCs and an invoker completion trigger; exact
signatures/grants are inventoried in `scripts/matter-continuation-inventory.mjs`.
No existing migration, domain row, contract, receipt, dirty marker or lease
history is rewritten. Service access to the new table is SELECT/UPDATE only,
with no INSERT/DELETE/TRUNCATE; PUBLIC/browser access is revoked.
The follow-up scopes the cooldown UPDATE to the two account streams, preserving
its signature/grants and compatibility with Data API safeupdate enforcement.

No new secrets, configuration variables, dependency, service or cron cadence are
required. Existing page-size variables remain strict integer 1–100/default 25.
The dashboard, Settings server actions and cron route cap duration at 180 seconds;
verify Node.js/Fluid Compute support and effective deployed duration before
release. The daily cron remains `0 6 * * *` UTC, authenticated by the exact Bearer
`CRON_SECRET`; manual actions retain the database-backed app session guard. Never
send credentials in URLs or browser state. Default invocation budgets are fixed
in code; reduced budget injection is used only by deterministic tests.

For a separately authorized rollout: disable all sync ingress/old preview writers,
drain existing workers, retain a backup, apply migrations in order, verify exact
catalog/grants and fresh/upgrade FINAL-head gates, deploy compatible code, verify
its runtime limits, then re-enable existing manual/cron ingress. One explicit
history initiation is sufficient; pending work persists across process/browser/
deployment changes, but remaining chunks may wait for the next daily invocation.
Completion certifies only exhaustion of that requested Matter enumeration.

For rollback, disable/drain ingress and prefer rolling forward. Leave the additive
schema, history intent/progress, contracts, receipts, dirty revisions and lease
generations intact. Task 13 writers still fence/commit pages and the new trigger
records bound history completion, but their one-page scheduler does not provide
Task 14 continuation/fairness or consult explicit history-intent idempotence. Keep older
sync writers disabled until compatible Task 14 code is restored; a read-only app
rollback can leave pending work safely. Task 12/older writers also lack atomic
page recovery. Do not reset cursors, delete intent/receipt/dirty rows, re-import by
destructive reset, remove RLS or apply production SQL as part of these tests.

## Task 15 release order and rollback

Apply `20261008095102_matter_shared_quota_retry_preparation.sql` after Task 14 and
before deploying Task 15 code. Disable and drain all writers/previews first: older
HTTP clients do not reserve the new quota. The migration creates server-only RLS
quota/preparation state and invoker RPCs/trigger, preserves existing progress and
seeds the account cooldown. Exact inventory: `scripts/matter-request-inventory.mjs`.
No new environment variable, secret, dependency, provider or cron cadence is added.
The existing daily `0 6 * * *` UTC schedule and ingress/auth/page limits remain.

Final-head fresh AND upgrade SQL/Data API evidence, grants/catalog, concurrency,
cleanup and runtime checks are prerequisites to a separately approved release.
See [Task 15 validation](task-15-validation.md). The quota coordinates participating
Matter Stats consumers only; other apps/private Matter MCP using the token remain
external, and upstream 429/headers remain authoritative.

Rollback disables/drains ingress and retains all quota, backoff, preparation,
stream/history, receipt/dirty and lease-generation state. Keep older sync writers
disabled; prefer compatible roll-forward or a read-only rollback. Do not delete
retry identities, reset cycles/cursors, drop additive objects, disable RLS or run a
production sync as rollback. Migration-before-code can coexist with drained old
code; its presence alone does not grant older consumers shared quota coordination.
