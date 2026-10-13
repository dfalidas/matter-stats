# Task 18: request-scoped query reuse and bounded aggregates

Scope: G3 / W5 / R5,R10 only. Fetched `origin/main` before work and recorded
`adf228f9e84d1d4a89d6cf8a609a13aacd315f26` (Task 17, merged PR #80),
matching the prompt baseline. Branch: `task-18-analytics-reuse`.
The draft PR records the final head SHA; this document cannot contain its own
commit hash. Local recovery checkpoints are saved in
`/workspace/task18-checkpoint.md`. Focused commits preserve baseline evidence,
query reuse, view contracts, acceptance evidence and final validation separately.

## Request ownership and query inventory

`analytics-query-context.ts` owns session and tag promises inside one service
invocation and binds them to the caller's Supabase client. No module mutable
cache, persistent cache, React global cache, new environment variable or general
caching framework is introduced. Protected page guards run before client/data
access, verified through actual server page execution.

Session scope is fixed to `reading_sessions`, with unchanged SQL date filters.
Compatibility requires a containing `[start,end)` and sufficient projection:
`details` includes attribution and longform's nullable reading-time metadata;
`streak` includes only `id,started_at,duration_seconds`. A narrow history input
cannot supply detail fields. Data scope/client identity, date bounds and
projection distinguish reads; timezone-dependent calculations remain outside
raw-input reuse and receive the captured timezone. Tag scope is fixed to the
existing complete `item_tags`/`matter_tags` projection and ordering, keyed by
normalized unique item IDs; only a containing ID set can supply a subset.
Different scopes, windows and projections never silently collide.

Promises are registered before awaiting: equivalent concurrent reads coalesce,
and compatible subsets filter the same successful complete input. A rejection
remains a rejection for all dependent reads in that invocation. There is no
empty fallback, partial success, or retry converted into a successful cached
value. A new request creates a new context and observes fresh data, including
after a previous failure. Existing keyset boundaries, duplicate/invalid-row
checks, empty-page exhaustion and encoded-size ID batching remain unchanged.

| Entry point | Inputs / reuse | Complete output |
| --- | --- | --- |
| Overview | Starts its already-required all-time detail read first; selected, today, comparisons and streaks reuse containing inputs. Future custom ranges remain distinct if outside that input. All-time tag input supplies subsets. | Internal selected/today/all-time metrics retained; page forwards selected totals/comparisons/calendar only. |
| Metrics | Selected and comparison details; one lean history read through the greatest of the existing best/current/historical cutoffs, filtered separately for each streak. | Existing totals, calendar comparisons, rankings, recent reads, heatmap, current and historical streak contracts. |
| Reports | Same selected detail promise used by metrics, complete timeline, longform and histogram; comparisons/history retain their bounds. One captured clock and timezone, including weekly latest-data navigation. | Complete internal `ReadingReport` adds four fixed histogram bins; timeline remains complete for useful internal consumers. |
| Reports page/client | `toReportsClientPayload` | Period, complete totals/comparisons, all calendar buckets for charts/CSV, fixed histogram; no session timeline or unused rankings/longform fields. |
| Year-in-Reading page/client | `toYearInReadingClientPayload` | Displayed metrics/calendar buckets, personality ranking inputs and four displayed longform results; no timeline or unused histogram/navigation fields. |

The largest history cutoff was already scanned before this change. No query is
broadened just to obtain reuse; the measured row/byte decreases demonstrate this
for the targeted cases. Application aggregation is sufficient, so no RPC,
index, migration or grants are added. The unused Reports `word_count` embed is
removed; nullable Matter library metadata semantics remain unchanged.

## Reproducible measurements

Baseline was captured before runtime edits using actual service entrypoints and
the installed Supabase client against `tests/fixtures/capped-postgrest.ts`.
A replay of the exact baseline also recorded complete-output SHA-256 hashes;
its counts, rows, response bytes and props sizes matched the initial capture.
Initial timings are retained. Final capture uses identical fixtures, parameters,
projections of displayed results, and caps. All 28 complete-output hashes match:
Overview's full internal metrics and Reports' metrics/timeline/longform/navigation
are byte-identical for unchanged fixtures (excluding the newly added histogram).

Environment: managed Linux x64, Node v24.19.0, exact `npm ci` lockfile. Synthetic
clock `2026-09-10T18:00:00Z`, timezone `Europe/Athens`. Fixtures: 1,200 or 10,037
60-second sessions with tied microsecond timestamps, 120 metadata items, 10%
unlinked sessions, nullable metadata, 1,200 tag links; response caps 100, 300,
1,000 with the unchanged requested page size of 500. Expected totals are
constructed independently as count, count × 60 seconds and count × 225 words;
CSV sums are checked independently. The actual metadata relation filters exclude
tag links for items with no linked sessions, preserving attribution rules.

HTTP count includes every boundary lookup, complete traversal page, successful
empty exhaustion query, metadata page/ID batch and weekly latest-row lookup.
Returned rows include boundary duplicates. Response bytes are UTF-8 serialized
JSON response bodies, excluding headers, TLS, compression and request bytes.
Client size is UTF-8 JSON of page result props before React Flight encoding;
it is not a measurement of compressed production wire traffic. Fixed auxiliary
Overview library/status fields use empty previews/null status in this controlled
comparison; their three bounded database requests are outside the targeted
analytics service count. Real server-page execution separately verifies actual
payload construction, authorization and bounded growth.

Elapsed time uses `performance.now()` around service execution and JSON props
serialization: one invocation per case in one process, no injected network/database latency.
The synthetic fixture timestamp cache can warm across cases. Some
verification ran concurrently in this shared environment. These noisy synthetic
numbers do not establish production query plans, database latency or throughput;
individual timings can be slower despite fewer requests/bytes.

Full before/after table: [comparison](evidence/task-18-comparison.md).
Machine-readable evidence: [before](evidence/task-18-before.json),
[after](evidence/task-18-after.json).

Reproduce after compiling tests:

```sh
node node_modules/typescript/bin/tsc -p tests/tsconfig.json
node scripts/task18-measurements.mjs > docs/evidence/task-18-after.json
node scripts/task18-compare.mjs
```

For baseline reproduction, archive the recorded SHA into an isolated directory,
use the same installed lockfile dependencies, copy the measurement script and
instrumented fixture, compile that checkout's tests and run the same script.
Optional projection exports fall back to the original complete page contract.
The comparison script rejects metric/timeline output changes and requires fewer
HTTP requests, rows, response bytes and client bytes in every matched case.
Increasing 1,200 to 10,037 sessions in the same Reports calendar period adds
only 10 JSON bytes; fixed bins and bucket counts remain unchanged.

## Correctness and acceptance

`analytics-query-reuse.test.ts` exercises concurrent equivalent reads, containing
and disjoint windows, incompatible projections, client-scope mismatch,
comparison/history cutoffs, original rejected promises, subsequent fresh
requests after failure/data changes, later session pages and later ID batches,
complete multi-page tags, boundary microseconds and captured timezone changes.

Its independent fixtures assert complete 1,200 / 72,000 seconds / 270,000 words
under all three caps; weekly/monthly/yearly totals and full-period CSV; 10,037
sessions and bounded payload growth; unlinked sessions and null metadata;
per-session rounding; all histogram boundaries including null/negative/zero
sessions. Histogram fixture durations independently sum to 7,800 seconds,
29,250 estimated words, and bin counts `[6,2,2,2]`. Zero-duration sessions retain
the existing first-bin counting rule.

`analytics-client-payload.test.mjs` executes the real three page modules with
only authorization/client creation and presentation boundaries stubbed. It
captures actual React child props for selected Overview, three report periods
and Year-in-Reading at 1,200 and 10,037 sessions. It verifies complete totals,
no raw timeline, no unused Overview results, bounded Reports growth and guard
failure before any database request. It does not claim browser-rendered E2E
or production data access.

The Task 16–17 completeness regressions remain active, including empty/exact/
partial pages, >10,000 rows, tied/null timestamps, duplicate/error rejection,
nullable object/array embeds, many tags/highlights and encoded-size batches,
DST/year/calendar comparisons, current/historical streaks, rounding, Activity
pagination and complete CSV. One old timezone test asserted redundant SQL query
bounds; it now adds sessions immediately before/at the lower bound and at/after
the exclusive end and asserts exact complete comparison totals/counts. No
completeness expectation or result cap was weakened. R5's Task 18 placeholder
is activated only with the executable HTTP/payload regression and matching
before/after evidence.

Client review follows the Vercel React best-practices skill: the Overview range formatter lives in a pure module, and all server service
imports in clients remain type-only; dates are existing React-serializable
Date values; payloads contain plain objects/arrays and primitives, no promises,
Maps or client credentials. Hooks remain unconditional before error rendering.
Existing controls, accessible labels, navigation, CSV and presentation are
unchanged. No new interactive behavior or interface redesign.

## Consistency, impact and rollback

Reuse guarantees that metrics/histogram/timeline/longform calculations using
one selected promise see the same session rows. It does **not** create an MVCC
snapshot: boundary reads, session pages, metadata batches, comparisons/history,
latest-week navigation and auxiliary status/library reads still occur in
separate transactions. Backdated inserts, unseen updates/deletes and metadata
changes can affect live traversals as documented in Tasks 16–17. Separate
requests remain fresh. Large histories still require complete server memory
and can encounter runtime limits; failures must not certify truncated totals.

No migration, dependency/lockfile change, environment contract change, data
mutation, production SQL, real Matter sync, deployment, token rotation or merge.
Authentication, cron, quotas/retries/leases/checkpoints and metric definitions
are preserved. Historical repair/backfill/enrichment remain Tasks 19–20.
Rollback is a code revert of Task 18; it requires no schema/data/environment
undo and retains Task 16–17 completeness. It restores duplicated reads and
larger props. Live/deployed performance and concurrent-write snapshot semantics
remain external gates; synthetic fixtures do not establish production behavior.

## Final validation

Checks below ran against runtime checkpoint `4ead3c0`; the final delivery commit
adds only refreshed measurement/validation evidence and documentation.

- **Passed:** exact `npm ci`; Next.js route-type generation; `npm run typecheck`;
  `npm run lint` (three preexisting Visual Explainer warnings, zero errors);
  `npm run test` (**335 passed, 0 failed/cancelled/skipped/TODO**);
  `npm run build`; all 28 output/hash and request/row/byte comparisons;
  `git diff --check`. The isolated-db script in the normal test command remains
  opt-in, independent of these unit/HTTP/page tests.
- **Failed:** `npm run audit:ci`, exit 1. Exact policy error:
  `A compatible remediation is available for chokidar; update the reviewed dependency baseline and remove the GHSA-vfj7-8cjw-p6xm exception`.
  The production audit has **0 vulnerabilities**; the full audit has **8 high
  entries**. Package versions, lockfile, audit policy and exception are identical
  to the recorded baseline. The current registry reports `fixAvailable: true`
  for this development dependency, so the existing policy correctly rejects its
  exception. Changing dependencies or weakening audit policy would violate this
  task's scope. This remains a release/CI gate, not a claimed passing check.
- **Blocked:** no implementation or draft-delivery blocker; audit remediation
  remains a release gate.
- **Skipped:** opt-in isolated fresh/upgrade/security database execution (no
  schema, migration, grants or database objects changed; not applicable here).
  Production SQL, real Matter sync, repair/backfill/enrichment, deployment,
  token rotation and merge were intentionally not run.
- **TODO:** separately authorized dependency remediation and passing audit before
  release; remote CI and deployed performance/consistency evidence. R5's Task 18
  executable regression is active; no test TODOs remain.

Initial arithmetic/empty-tag shape mistakes and an obsolete exact-query
assertion were corrected. An initial restricted test invocation failed/hung in
subprocess orchestration; it was stopped and rerun in the sandbox with networking
permission needed for child-process/loopback fixtures, as in prior Task 16
validation. The final full run completed successfully without contacting a real
database or Matter. Earlier failures are not final acceptance evidence.

Sanitized check summary: [validation JSON](evidence/task-18-validation.json).
