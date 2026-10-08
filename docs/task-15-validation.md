# Task 15 validation: shared Matter quotas and bounded retries

Scope: Task 15 only, F2 / W4 / R3,R4; dependencies Tasks 12–14. Actual fetched
base: `579317397d5ea4da53a5fe636fc370629fe1065e` (2026-10-08); origin/main had not
advanced. Branch: `codex/task-15-shared-quotas`. Final head and exact CI evidence
are recorded in the PR delivery record; an earlier pass never substitutes for
final-head acceptance. No deployment, merge, production SQL, repair, token
rotation, new provider/queue or real Matter sync is authorized by this change.

## Contracts and policy

The official [rate limits](https://docs.getmatter.com/api/rate-limits),
[errors](https://docs.getmatter.com/api/errors) and
[pagination](https://docs.getmatter.com/api/pagination) were retrieved on
2026-10-08. Documented limits: 120 GET/minute, all-request burst 5/second,
20 markdown GET/minute counted against both GET and markdown quotas. Generic
400/422 is not a documented invalid-cursor signal. No cursor restart is added.

`matter_quota` is a server-only singleton for this private single-account app.
The scope is always `matter`, including bootstrap before `/me`, all streams,
manual/cron invocations and instances. It does not depend on a trigger, stream,
account response, token hash, service-key version or process identity. No raw
Matter token or token-derived credential is stored. Even changing credentials
cannot create a parallel allowance within the same backend. A multi-account
application would require a separately designed scope; it is outside this task.

Admission locks the singleton, samples database time after lock acquisition,
prunes timestamps outside `(now - window, now]`, checks the account not-before
and feedback constraint, and atomically reserves one slot in each applicable
window before HTTP. Every attempt, including `/me`, reads, annotations and
retries, enters that RPC and consumes the unchanged invocation request budget.
Failed/uncertain reservations are conservatively consumed. Admission failure
never falls back to process pacing or bypasses SQL; refusals issue zero HTTP.
There is no transaction spanning upstream HTTP. State is bounded to arrays of
120/5/20 reservations; expired reservations are pruned on the next admission.

For example, five starts at `00:00:59.900` still occupy the second window at
`00:01:00.100`; another five are not available at the calendar boundary. They
expire precisely at `00:01:00.900`. Likewise, 120 GETs and 20 markdown GETs at
`00:00:59.900` remain counted until `00:01:59.900`. The same production pure SQL
evaluator is exercised with exact injected timestamps in both migration paths.
Its evaluation cannot mutate/reserve capacity and is service-only.

Header integers reject signs, whitespace, suffixes, fractions, exponent notation,
unsafe numbers and inconsistent remaining/limit pairs. Unix resets must be future
finite timestamps through year 9999. Retry-After accepts whole nonnegative seconds
and canonical IMF-fixdate with validated calendar/weekday, including valid long
delays; past valid dates become zero and a 429 still defers at least one second.
Missing/invalid Retry-After uses **60 seconds**. A later valid reset wins. Header
feedback is consumed on successful and failed responses, with missing reset using
a conservative 60-second feedback horizon for a valid limit/remaining header.
Advertised limits only tighten capacity. Since generic headers do not identify
a quota bucket, lower advertised capacity conservatively constrains all reads.
All later reservations are subtracted from a response's remaining value. Active
feedback uses minimum remaining and maximum reset; cooldown is maximum-only.
Stale/concurrent feedback cannot replenish capacity or shorten a cooldown.

The shared quota is authoritative for participating **Matter Stats** consumers
only. Another application or the private Matter MCP using the same token is not
coordinated or modified. Upstream headers and 429 remain authoritative; this
coordinator may therefore defer even when its own rolling windows have space.

Application retry policy (not upstream requirements): **3 attempts total**,
initial included; backoff **500 ms × 2^(attempt−1)** plus integer jitter **0–250 ms**,
capped at **2,000 ms**; at most **2,000 ms cumulative waiting per read operation**, including quota/retry waits. Before
waiting, enough upstream time for that delay plus one request must remain. Retry
only GET reads after the owned 10-second request timeout, explicitly classified
transport codes (`ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EAI_AGAIN`,
`ENETUNREACH`, Undici connect/headers/body timeout or socket errors), or HTTP
**500/502/503/504**. Other 5xx and generic TypeError are not retryable.

Each attempt rechecks admission, cancellation, budget and lease ownership. The
unchanged ceilings are **8 committed pages / 224 actual attempts / 90 seconds
upstream / 150 seconds total / 10 seconds per request / 180 seconds ingress**.
Long quota/retry waits return safely for the existing manual/daily continuation.
Quota refusals perform no attempt or failure increment. HTTP 429 consumes its actual attempt but does not increase transient failure count; it returns to continuation rather than automatic HTTP retry. A reservation records
its retry attempt before HTTP, so process death cannot replenish a chain.
Exhausted chains never reset automatically or by TTL. An intentional manual sync
can start another bounded chain only after the persisted **15-minute** eligibility
deadline; it keeps the cursor, active contract, generation and all prior prepared
reads. Authentication/400/422 errors and protocol failures remain terminal for
automatic continuation; deliberate manual recovery after the same deadline can
retry a corrected outcome. Optional 403/404 behavior is unchanged. Missing
session-item linkage still initiates no enrichment. No ambiguous database write
is classified as transient HTTP; existing receipt replay remains unchanged.

## Preparation, fencing and completion

`matter_request_work` has exactly three slots: bootstrap and the two streams.
The stream preparation is fenced to the immutable current page contract. At
most 256 URL-SHA256 request identities and 8 MiB JSON are retained per slot;
each response retains the existing 4 MiB bound. Successful validated HTTP reads
and optional-endpoint unavailability are cached, separate from ingestion. Retry
counts and next eligibility live in that same bounded state. Bootstrap successes
are removed immediately, so `/me` is rechecked in fresh invocations.

On continuation, the exact page can reuse previous reads and fetch only missing
ones. A failed/deferred page still imports nothing and advances no cursor,
watermark or history-completion marker. The final plan uses the unchanged atomic
commit/receipt/dirty-marker boundary. A stream trigger clears its preparation
in that same transaction; receipt replay adds no effects. Unknown commit outcomes
continue through Task 13 reconciliation. There is no TTL that discards an active
page. A new page/cycle replaces only its own preparation.

A pinned 100-session page with 100 linked lookups and 100 annotation requests
needs 201 reads. Under the real 120/minute policy, invocation one reserves `/me`
and 119 page reads, then defers with no ingestion. After eligibility, invocation
two runs the fair sibling first, reuses those 119 reads, fetches the missing 82,
and commits the complete page. Neither limit nor filters change. Stream turns
remain persisted before reads, so expensive/retry-exhausted pages cannot repeatedly
claim the sibling's first turn. Dirty rollup recovery remains before cooldown.

List envelopes and advancing cursors are validated before cache or commit.
Annotation/iterator loop protection is bounded to 100/10,000 pages, respectively.
A bounded durable 10,000-cursor hash history per active stream detects A→B→A across
continuation invocations. Exceeding that bound is a protocol failure requiring
explicit investigation, never completion. Its trigger runs inside page commit,
so rejection rolls back effects, receipt, watermark and history completion.

## Evidence and gates

Local `npm ci`, CI-required `next typegen`, typecheck, lint, test, build and
`audit:ci` have been executed. The updated suite reports **255 passed,
0 failed, 2 TODO, 0 skipped (257 total)**; lint has the same three preexisting
Visual Explainer warnings. Production audit: **0 findings**; full audit: **8 high,
0 critical/moderate/low**, all within the unchanged development-only
`GHSA-vfj7-8cjw-p6xm` policy. Final checks/results are retained in the PR.
R4 remains TODO until final-head real acceptance; R5 is unrelated Task 16 work.

The new deterministic HTTP/clock/randomness suite checks retries across recreated
runtimes, exact timeout/5xx bounds, bootstrap admission, durable cooldown refusal,
strict headers, auth/generic errors, invalid JSON/envelopes/cursors, lease loss,
caller cancellation and ambiguous cache-write refusal. Existing 5,000-session,
receipt/atomicity and dirty-rollup regressions are retained.

Both real disposable paths additionally run `matter-requests.mjs`: exact SQL
window boundaries, 16 independent processes competing for five burst slots,
markdown double-accounting, stale feedback, `/me` 429/process recreation,
persisted retry exhaustion, a valid 201-read expensive page, sibling fairness,
lease takeover, durable cursor loops, valid anon/authenticated denials, service
controls and cleanup. Catalog inventories all new signatures/RLS/grants, including
trigger EXECUTE denial using actual SQL browser roles. Upgrade snapshots Tasks
11–14 streams, lease, receipts, dirty work and history intent before/after Task 15.
The older synthetic suites explicitly expire/reset their owned quota fixtures
between unrelated fault scenarios; Task 15's expensive-page and recreated-process
scenarios retain their durable state. Production never uses fixture reset code.

**Local database gate BLOCKED before SQL execution:** the pinned stack's vfs image
provisioning exceeded the 32 GB filesystem and a pull also reported registry rate
limiting. No fresh/upgrade pass is inferred. The runner stopped its owned fresh
stack and removed its temporary directory; no database/containers remain. Initial
local unit execution also encountered sandbox child-process restrictions; rerun
with the authorized process access passed. These failed attempts remain evidence.
An intermediate audit reported compatible remediation from cached npm metadata;
the same policy passed with CI's Node 22.23.3 and an isolated metadata cache.
Earlier real CI runs found the old fixture's intentionally looping cursor and
a timestamp-spelling cache invalidation; both were corrected and strengthened
with regression assertions. They are not final-head acceptance evidence.
The pinned CLI's npm downloader ignored the managed proxy; its exact 2.48.3 binary
was downloaded through that proxy, checksum-verified and used to generate the
migration. No repository dependency/CLI pin changes were made.

## Schema, compatibility and rollback

Additive migration: `20261008095102_matter_shared_quota_retry_preparation.sql`,
generated with verified Supabase CLI 2.48.3 after reading migration help. It adds
two RLS singleton-state tables, six service-only invoker functions (empty search
path), and one stream trigger. Browser/PUBLIC privileges are revoked. Service
access is SELECT/UPDATE, with no INSERT/DELETE/TRUNCATE. Existing rows/contracts/
receipts/dirty work/lease generations/history intent remain intact; legacy
cooldown seeds the new account scope. No environment values, secrets, authentication,
cron schedule, providers, dependencies, page-size defaults or history coverage change.

For a separately authorized release: disable/drain every writer and preview,
backup, apply all migrations through Task 15 **before** code, verify catalog and
FINAL-head fresh/upgrade evidence, deploy compatible code, then enable the existing
manual/cron ingress. Migration alone cannot coordinate older HTTP clients.
Rollback disables/drains ingress and leaves quota, backoff, preparation, contracts,
receipts, dirty work and generations intact; prefer compatible roll-forward or a
read-only rollback. Older sync writers stay disabled. Never clear retry identity,
reset cursors, drop state, remove RLS or revert applied migrations to roll back.
Production rollout/migration/runtime verification, actual Matter payload/headers
and external token consumers remain external gates. See deployment and the
security release runbook.
