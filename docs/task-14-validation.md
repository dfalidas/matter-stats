# Task 14 validation: bounded continuation and explicit available history

Base: `198701e187e2b49522eb40451c8c87d9a72beda7`, fetched origin/main on
2026-10-07. No newer main commits were present. Branch:
`codex/task-14-continuation-backfill`. Task 14 only; Tasks 15–21 remain separate.
Migration: `20261007132750_matter_continuation_history_intent.sql`, generated with
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
Ingress maxDuration is 180 seconds on dashboard/Settings/cron. Existing page sizes
are 1–100/default 25. Admission reserves the maximum later-page request cost;
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

## Current evidence

Local `npm ci` passed with the unchanged lockfile (workspace npm cache was needed
because the default home cache was unavailable). Route type generation, typecheck,
build and audit passed during implementation. Lint retains only the three existing
Visual Explainer warnings. The regular suite and disposable FINAL-head gate are
rerun before delivery; intermediate results are not final-head proof.

The first local disposable startup was interrupted while CLI 2.48.3 downloaded
images. Its gate recorded failure, the owned fresh stack was stopped and temporary
directory removed. No SQL/Data API acceptance was established by that attempt.
The subsequent gate and hosted final-head checks must supply real passing evidence;
unavailable/failed execution remains BLOCKED/FAILED, never passed. The R3 TODO
remains until the real 5,000-session acceptance is established. Sanitized permanent
evidence and exact final PR-head workflow/artifact links are added after execution.

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
