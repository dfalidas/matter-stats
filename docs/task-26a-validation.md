# Task 26A — safe budget continuation

Base: current main `c7ac54a`. Synthetic evidence only; no production inspection,
Matter request, import/cron invocation, migration, environment change or deployment.
Historical operator observations do not establish the cause of an individual pending
request, its present state, or worker liveness.

## Demonstrated cause and narrow correction

Two deterministic HTTP/store fixtures fail against the base: (1) the coordinator
checks budget, awaits lease renewal, then reserves even if renewal consumed the
remaining time; `attempt()` immediately stops, leaving the reservation pending;
(2) a validated response is discarded by the post-result deadline check instead
of reaching `finish_matter_request`. Both can produce a deadline message and an
attempts=1 pending entry. Neither proves what happened in production.

Admission now requires a complete request window plus the existing 10s database
HTTP ceiling, both before and after renewal. The owned attempt has its full
unchanged 10s timer, rather than truncating it to a routine deadline. A successful
validated result reaches fenced durable finalization without a post-result
budget rejection. After a timed-out renewal, an abort check prevents late HTTP.
No new database outcome classification, RPC or migration is introduced.

Lifecycle: budget/lease/cancellation checks → durable admission and sequence →
owned timed preparation (renewal, fetch, restrictive feedback, body validation,
renewal) → renewed lease and sequence-fenced finalization → whole-page validation
and atomic receipt commit → bounded rollup recovery, status, compare-and-release.
At the upstream boundary, successful request preparation can be retained without
committing an incomplete page. A later invocation reuses that preparation.
The 90s upstream/150s total split already leaves 60s for finalization and cleanup;
request finalization is at most renewal + finish (20s), followed by continuation
read/run update/release (30s) and best-effort invocation audit (5s). Database HTTP
remains capped at 10s and remaining total time. Rollup recovery retains its existing
60s-margin admission check. Timers are execution bounds, not process-liveness guarantees.

Process death, caller cancellation, lost lease, unverified admission/feedback or
ambiguous finalization remain fail-closed. Overshooting a database HTTP ceiling or
process suspension between reservation and work cannot be proven safe and may
still leave pending work. This change does not repair existing unknown entries.
Owned request timeout/classified transport failures retain the existing bounded
transient chain; protocol/auth/other terminal failures and exhausted retries retain
deliberate manual recovery, no sooner than the persisted 15-minute eligibility.
Attempts already consumed and successful sibling reads survive.

## Preserved contracts

Cron remains `/api/cron/sync-recent-activity`, `0 6 * * *` UTC, invoking only
`recent_activity_scheduled` with recovery disabled. It continues explicitly
requested history and active library work; it starts neither an unrequested
library import nor completed history again. Ordinary incremental sync remains.
No dependency, quota, batch-size, duration, schedule, cursor, generation, receipt,
page contract, fair scheduling or lease/atomic-commit policy changes.
Limits remain 8 pages / 224 attempts / 90s upstream / 150s invocation / 10s request
and database HTTP / 180s ingress. Existing 120 GET/minute, 5/second and 20 markdown
GET/minute quotas are unchanged.

Status distinguishes checkpoint eligibility, cooldown/backoff and deliberate
recovery. Eligibility does not promise execution time. Available-history completion
is distinct from an older incremental completion; processed counts are not unique
new records or a historical completion percentage.

## Verification and release gates

New HTTP fixtures cover both demonstrated causes, residual-time refusal, late
renewal cancellation, successful cache reuse, lost lease/caller cancellation and
ambiguous database finalization remaining blocked even after eligibility. The
fake store models the SQL pending guard. Existing exhaustion/protocol/manual
recovery tests remain. The real fresh/upgrade continuation suite additionally
checks deadline interruption at item/annotation preparation, no pending entries,
retained successful reads, same generation, scheduled resumption and one stored
session after overlapping continuation. Existing suites verify receipt replay,
fairness, full-history completion and subsequent incremental operation.

Actual command results and final-head CI are recorded in the draft PR and private
Craft log. Local unit/HTTP fixtures do not certify database behavior; real isolated
CI and its cleanup evidence must pass at the final head. Production remains
unverified. Supabase changelog and JavaScript abort-signal reference were reviewed;
no Supabase API/schema/security contract is changed.

Review the focused diff and all three required CI jobs at the final head before
any separate merge/rollout decision. Preserve installed migrations and durable
state. For an authorized rollout, follow the security release runbook, verify the
compatible deployed SHA/Node 22/runtime bounds and unchanged cron, then refresh
Settings read-only. Existing pending/terminal/exhausted entries still need diagnosis
and the existing eligible manual action; never reset them or enable cron recovery.
Observe two actual scheduled invocations and compare checkpoints, retry status,
unique stored IDs and terminal evidence separately for both streams. No such
production action is authorized or performed by this task.
