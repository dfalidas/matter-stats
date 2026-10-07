# Task 14 validation: bounded continuation and explicit available history

Base: `198701e187e2b49522eb40451c8c87d9a72beda7`, fetched origin/main on
2026-10-07. No newer main commits were present. Branch:
`codex/task-14-continuation-backfill`. Task 14 only; Tasks 15–21 remain separate.
Migrations: `20261007132750_matter_continuation_history_intent.sql` and
`20261007145024_bound_account_cooldown_update.sql`, generated with
Supabase CLI 2.48.3 after checking its help. Applied migrations remain unchanged.

## Implementation and acceptance gate

The production scheduler commits sequential pages under one lease and one budget.
The next expected contract comes from the returned durable state; the preceding
receipt is freshly read each time. Page effects/checkpoint/receipt/dirty revisions
remain in the existing Task 13 SQL transaction. The new completion trigger marks
history exhausted in that same transaction. Intent, full-history start, scheduling
turn and account cooldown RPCs assert/lock the same Task 12 lease transactionally.
No HTTP occurs inside SQL; recovery retains exact revisions and bounded work.

Budgets: 8 committed pages, 224 Matter attempts, 90 seconds upstream preparation,
150 seconds total, 10-second per-attempt cancellation and database HTTP timeout.
Ingress maxDuration is 180 seconds on dashboard/Settings/cron.
Recovery admits no new marker with less than 60 seconds of the total budget,
reserving one marker's three serial HTTP stages and progress/logging/release.
Fractional clock remainders are rounded down for integer cancellation timers.
Existing page sizes are 1–100/default 25. Admission reserves the maximum later-page request cost;
fresh defaults fit a maximum valid page (201 preparation calls plus `/me`).
All accepted enrichment belongs to the complete page plan, which is discarded on
budget stop. Existing pacing remains; no sync retries/long sleeps/shared account
quota are added. Sustained upstream slowness or cooldown can defer any operation.

One authenticated history request persists `all`, with `/reading_sessions` and no
`since`, after an active narrower cycle finishes. It bypasses a completed narrow
watermark, pins endpoint/filters/limit/start/generation/cursor across dates and
triggers, and matches idempotently even after completion. No optional lower-bound
history input is exposed; unsupported coverage is rejected. No reset/re-import,
raw-row deletion, receipt/dirty-work clearing or lease-generation reset is used.
Completion means this requested enumeration exhausted what Matter made available;
retention/universal historical completeness and analytics repair are not claimed.

The unchanged daily 06:00 UTC cron resumes durable work with a persisted fair
stream turn. It never requests full history or unrequested library enumeration.
Closing the browser/process/deployment does not cancel intent/progress. Remaining
chunks can wait until the next scheduled day; manual resumes may accelerate them.
Partial/busy/cooldown responses do not certify completion. Existing DB run labels
and constraints remain unchanged; partial successful work records has_more and no
completed checkpoint in its run. Run reconciliation remains Task 21 scope.

The fresh/upgrade runner now executes `matter-continuation.mjs` in addition to the
existing security/Task 12/Task 13 suites. Its deterministic 5,000-session fixture
uses documented id/date/seconds_read/object, ties and multiple years. Each worker
is a fresh process with new runtime dependencies. Production cron/HTTP/page/SQL
paths run against real disposable SQL/Data API; only Matter HTTP and fault
transport are synthetic. An independently generated SQL reference compares all
IDs, raw durations and timestamps. It checks pinned parameters and all 51 pages,
partial/completed watermark boundaries, pending library fairness, completed repeat
and overlap, terminal lost-response replay, expensive-page admission, real item/
annotation request/time interruption, failures/cooldown and actual browser grants.
Trigger-function EXECUTE denial uses real SQL browser roles because trigger-returning
functions are intentionally absent from PostgREST RPC discovery.
Existing deterministic lease/takeover barriers and atomic/dirty-recovery faults
are retained. Upgrade compares Task 13 receipts/dirty revisions and all prior
legacy/stream/cooldown/lease state across Task 14. Owned fixtures/Auth/stack cleanup
must pass. No production or real Matter credentials are provided to test children.

The large fixture exposed disposable Kong upstream connection resets (HTTP 502).
The runner disables connection reuse only in its owned gateways using Kong's
documented `KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0`, reloads the CLI's unchanged custom
template, and asserts the effective setting. Each path records `gatewayTransport`.
All requests still traverse the real gateway/Data API, grants and RLS. No failure
is accepted, no retry or authentication bypass is added, and production gateway
configuration remains a separate deployment concern. Sources: the pinned
[Kong configuration](https://github.com/Kong/kong/blob/2.8.1/kong.conf.default#L771)
and [CLI startup](https://github.com/supabase/cli/blob/v2.48.3/internal/start/start.go).

## Current evidence

Real disposable fresh **and** upgrade SQL/Data API acceptance passed on
`e900f57b0d9dca95a911c22b9d35ab6da2689444` in
[CI run 37650167397](https://github.com/dfalidas/matter-stats/actions/runs/37650167397).
The [sanitized database artifact](https://github.com/dfalidas/matter-stats/actions/runs/37650167397/artifacts/11496618372)
records both paths, all 16 migration versions, real browser-role denials/service
controls, atomicity/fencing/recovery and owned fixture cleanup. Each path's
independent SQL reference found **5,000 distinct IDs, zero raw-data mismatches,
1,460,736 seconds**, matching its reference total. History required 51 session
pages and seven recreated server/cron invocations. Both stacks were stopped and
the runner's temporary directory was removed. The verified owned-gateway setting
is recorded separately from application/runtime configuration.

The standard CI job on that SHA passed npm ci, route type generation, typecheck,
lint, tests, build and audit:ci: 239 passed, 0 failed, 3 TODOs, 0 skipped (242 total)
before R3 activation. The earlier complete local checks on
`120efb8eca1310ed549bd0ed766c6b24c163ca61` remain recorded. Lint retains three
existing Visual Explainer warnings. Production audit findings: zero; the existing
development-only GHSA-vfj7-8cjw-p6xm exception remains unchanged.

Only after that real acceptance, the R3 5,000-session TODO was activated in the
production-entrypoint suite. Its pinned parameters, preceding receipts, seven
invocations, empty terminal page and candidate watermark assertions pass. The
standard suite then reports **240 passed, 0 failed, 2 TODOs, 0 skipped** (242 total).
The unrelated R4/R5 TODOs remain. The final database fixture additionally stops
an expensive valid page inside annotation preparation, then resumes the same
stored contract in a fresh invocation across a year boundary without resetting
its cycle, and commits its complete 100-annotation-page preparation.

[task-14-evidence.json](task-14-evidence.json) is an immutable, sanitized snapshot
linked to the accepted pre-final SHA. The final code/evidence commit must run the
same fresh/upgrade gate again. Exact final-head CI, artifact and cleanup links
are retained in the draft PR and delivery record; an earlier pass never substitutes
for final-head acceptance. This avoids claiming a commit contains evidence of its
own not-yet-created hash.

Earlier attempts remain failed/blocked evidence. GitHub's
[2026-10-07 incident](https://www.githubstatus.com/incidents/djlmxz2zd0j7) delayed Git
operations/PR synchronization/Actions. The local 32 GB vfs workspace could not
provision the PostgreSQL image; its owned startup/stack/temp directory were cleaned
up. Local database provisioning remains BLOCKED, and no SQL acceptance is inferred
from it. The hosted gates above performed the real execution.

The failed cooldown gate exposed SQL 21000 for the first migration's unfiltered
UPDATE under safeupdate. The additive follow-up selects exactly the two streams.
The service-only fixture verifies the enabled guard and unfiltered UPDATE rejection,
then the bounded production cooldown RPC, in a real Data API transaction. It uses
no privileged SET/LOAD and is dropped during cleanup. Later gateway diagnostics
identified upstream connection resets; the owned disposable transport mitigation
is described above. No unexpected HTTP failure, permission mismatch or malformed
payload is accepted as successful verification. Diagnostics retain known numeric
counts/public gateway messages, never raw credentials or container logs.

## Official sources and rollout

Retrieved current official Matter [sessions](https://docs.getmatter.com/api/reading-sessions/list),
[pagination](https://docs.getmatter.com/api/pagination) and
[rate limits](https://docs.getmatter.com/api/rate-limits). Full enumeration omits
`since`; page size is 1–100 and `has_more` is authoritative. No new unsupported
session order/until/updated_since or fabricated linkage is introduced.

Reviewed the current Supabase [changelog index](https://supabase.com/changelog.md),
[Postgres breaking-change notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes),
[API grants/RLS](https://supabase.com/docs/guides/api/securing-your-api) and
[functions](https://supabase.com/docs/guides/database/functions). Explicit grants,
invoker security and empty search_path do not depend on changing public defaults;
this task upgrades no engine, CLI pin, framework or dependency. Reviewed current
[Vercel duration](https://vercel.com/docs/functions/configuring-functions/duration)
and [limits](https://vercel.com/docs/functions/limitations): Fluid Compute Node.js
has a 300-second default. The 180-second ingress/application budgets retain finite
margins; actual deployment configuration requires verification before rollout.

For separately authorized rollout: disable/drain all writers and previews, backup,
apply the additive migration before code, verify catalog/FINAL-head fresh+upgrade
and runtime limits, deploy compatible code, then re-enable the existing ingress.
Rollback disables/drains ingress and leaves all additive history/progress/receipt/
dirty/lease state intact for compatible code. Older one-page/unfenced writers must
stay disabled. No merge, deployment, production SQL, real Matter sync, secret
rotation or personal-data mutation was performed. See deployment.md and the
security release runbook for the exact access inventory and release order.
