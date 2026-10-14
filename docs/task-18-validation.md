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

## Original Task 18 local validation (historical)

The results below preserve the original delivery-time record. The audit
interpretation and outstanding CI/database/preview gates are reconciled in the
follow-up section below. Checks ran against runtime checkpoint `4ead3c0`; the delivery commit
adds refreshed evidence/documentation, measurement-method wording and a
whitespace-only helper cleanup; application behavior is unchanged.

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
  to the recorded baseline. The local npm report contained `fixAvailable: true`, which the unchanged
  policy rejected. This was initially interpreted as a compatible dependency
  fix and recorded as a release gate. The follow-up below proves that this
  interpretation came from incomplete npm metadata; the command failure itself
  remains historical evidence. No dependencies or policy were changed.
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


## Audit discrepancy follow-up (2026-10-13)

Scope is evidence/documentation only on the existing draft PR #81. Local and
remote heads were inspected first and both matched reviewed head
`6c500b02a0680dc3e8d8f196a607e38b7840d1be`; the worktree was clean.
Task 18 implementation, measurements, dependencies, lockfile, audit policy,
exception and CI enforcement are unchanged. No application checks or benchmark
runs were repeated. The previous local audit failure is retained above and in
`historicalLocalValidation` in the validation JSON.

### Exact CI-toolchain reproduction

An isolated archive of reviewed SHA `6c500b02a0680dc3e8d8f196a607e38b7840d1be`
was installed with the official Node **22.23.3** binary and bundled npm
**10.9.9**, matching the successful CI job. The binary was verified against
Node's official SHA-256 manifest. Registry: **https://registry.npmjs.org/**.
A new empty `mktemp` cache was scoped to both installation and audit; neither
repo `node_modules` nor the original reports were overwritten.

| Verification | Node / npm | Cache | Command / exit | Full high entries | Production findings | Chokidar remediation |
| --- | --- | --- | --- | ---: | ---: | --- |
| CI run 38415550720 | 22.23.3 / 10.9.9 | GitHub runner | `npm run audit:ci` / 0 | 8 | 0 | `false` |
| Fresh isolated reproduction | 22.23.3 / 10.9.9 | Initially empty, writable | `npm ci` / 0; `npm run audit:ci` / 0 | 8 | 0 | `false` |
| Original runtime control | 24.19.0 / 11.9.0 | Default `/home/agent/.npm`, unavailable in sandbox | `npm run audit:ci` / 1 | 8 | 0 | `true`, with empty affected ranges |
| Same installed tree/runtime control | 24.19.0 / 11.9.0 | New empty, writable | `npm_config_cache=<new-cache> npm run audit:ci` / 0 | 7 | 0 | `{name: "tailwindcss", version: "4.3.3", isSemVerMajor: true}` |

The npm 10 reproduction's full and production reports are **byte-identical** to
retained CI artifact **11824311698**, whose archive checksum was independently
verified. Full JSON SHA-256:
`39ee0782148e3cd818235b3fe5c541c200e94603c1103d750cfe09c2d4f58938`.
Production JSON SHA-256:
`31b90573b69000532cd0814cdaad5c24409299b1b2915c09085d2cb844233cfa`.
The original failure's reports are also reproduced byte-for-byte by the
unavailable-default-cache control. Each control uses the same registry and
locked installed dependency tree; no `audit fix`, overrides or force flags.

Reproduction outline (the exact snapshot and binary checksums are in JSON):

```sh
# Download/verify official Node 22.23.3 and put its bin directory first in PATH.
audit_case=$(mktemp -d /tmp/task18-audit-match.XXXXXX)
mkdir "$audit_case/work" "$audit_case/cache"
git archive 6c500b02a0680dc3e8d8f196a607e38b7840d1be | tar -x -C "$audit_case/work"
cd "$audit_case/work"
export npm_config_cache="$audit_case/cache"
node --version                  # v22.23.3
npm --version                   # 10.9.9
npm config get registry         # https://registry.npmjs.org/
npm ci                          # exit 0
npm run audit:ci                # exit 0, unchanged command/policy
```

### Proven cause and dependency verification

This is an npm metadata/caching failure in the sandbox, not a proven new
compatible dependency remediation. The default cache cannot be created there.
`npm view chokidar@3.6.0 version --json` exits **1** with:

```text
ENOENT: no such file or directory, mkdir '/home/agent/.npm/_cacache'
Invalid response body while trying to fetch https://registry.npmjs.org/chokidar
```

The installed `@npmcli/metavuln-calculator@9.0.3` catches package-metadata
(`packument`) fetch errors in `lib/index.js` and substitutes `{name, versions:{}}`.
Consequently npm can emit successful audit JSON with incomplete downstream
remediation calculations even though the bulk advisory endpoint succeeded.
The historical report has empty affected ranges on all entries and no
`chokidar.effects` parent; npm 10's valid report has range `2.0.0 - 3.6.0`,
parent `tailwindcss`, and `fixAvailable: false`. Changing only cache availability
on the same Node/npm/installed tree reproduces or removes the original failure.
This establishes the cache/metadata cause; **npm version alone is not the cause**.
Fresh npm 11 also computes seven entries and major remediation candidates;
the remaining version-specific attribution differences were not fully traced
and are not treated as disappearance of the advisory or proof of a supported fix.

The [official advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
(updated 2026-10-02) covers **braces <= 3.0.3**, has **no first patched version**,
and describes stack-exhaustion denial of service through deeply nested patterns.
Registry metadata still lists **3.0.3** as the latest stable braces release.
The actual lockfile has:

- `tailwindcss@3.4.19 -> chokidar@3.6.0 -> braces@3.0.3`;
- `tailwindcss@3.4.19 -> micromatch@4.0.8 -> braces@3.0.3`;
- `eslint-config-next@15.5.27 -> @next/eslint-plugin-next@15.5.27 -> fast-glob@3.3.1 -> micromatch@4.0.8 -> braces@3.0.3`.

Tailwind specifies **chokidar ^3.6.0**. The highest published version satisfying
that range is **3.6.0**. Chokidar **4.0.3** drops braces but fails that parent range
so it is not a supported compatible transitive patch.
It also would not remove the independent micromatch/ESLint paths. Fresh npm 11's
Tailwind **4.3.3** target is explicitly a **major** change; npm's ESLint target
**14.2.35** is an incompatible downgrade from the Next 15 configuration. These
are unreviewed suggestions, not endorsed full remediations. No supported
compatible dependency change was verified or performed.

The real development-only advisory remains. The unchanged exception still
applies; production audits remain clean. The originally inferred compatible-fix
release blocker is reconciled under the CI toolchain with a valid cache. This
conclusion comes from artifact equality, controlled reproduction, official
advisory metadata and dependency-range checks—not merely green CI.

### Completed CI, database and preview evidence

[CI run 38415550720](https://github.com/dfalidas/matter-stats/actions/runs/38415550720)
completed successfully. Its **verify** job `115358903865` checked out the PR test
merge **27e2716b41a8f7572dd016d5d953def1eca797d7**, not the branch commit directly.
The job log confirms that SHA and Node/npm versions. GitHub's merge tree and the
reviewed head both have tree **7ff9f2ca2927fd4b18d4d3968926373a34d1815d**, so their
contents are identical. Install, route generation, typecheck, lint, 335 tests,
build and audit passed. The artifact's workflow head is reviewed **6c500b0**;
that association is distinguished from the actual verify checkout SHA above.

The **fresh/upgrade database** job `115358903214` checked out exact branch head
**6c500b02a0680dc3e8d8f196a607e38b7840d1be**. Retained artifact **11823814476** was
downloaded and its SHA-256 verified. Its `ci.json`, `results.json` and
`cleanup.json` confirm both paths passed catalog/grant/RLS and Data API checks,
lease/fencing, atomic-page/rollup, continuation/history and shared-quota/retry
verification; upgrade data/state preservation passed. These used real SQL/Data
API only in owned disposable instances and synthetic Matter fixtures. Cleanup
passed: both resources stopped and the temporary directory was removed.
No database verification or SQL was rerun in this follow-up.

The existing Vercel branch preview deployment
`dpl_GkUSiempk6A5btp9Cu84L68ZsBri` is **READY** and its provider metadata pins
**6c500b02a0680dc3e8d8f196a607e38b7840d1be** on `task-18-analytics-reuse`.
GitHub's commit status is `success`. Immutable URL:
https://matter-stats-5c66k85os-dfalidas-7836s-projects.vercel.app .
This proves successful existing preview deployment/status only; no browser,
authenticated analytics, production correctness or performance test is inferred.
No deployment was initiated by this follow-up.

### Current result and remaining gates

- **Passed:** fresh CI-version `npm ci` and unchanged `audit:ci`; exact CI-report
  equality; same-runtime cache controls; advisory/parent-range verification;
  evidence JSON/hash/scope checks and `git diff --check`. Completed CI/database/
  preview results above are attached to their actual original SHAs.
- **Historical failed:** the original local audit and reproduced unavailable-cache
  control (exit 1), preserved without relabeling them as successes.
- **Blocked:** no audit discrepancy or newly established compatible-remediation
  blocker under the unchanged policy. The real advisory and its exception remain.
- **Skipped:** unrelated application checks, Task 18 measurements, new database
  runs and preview functional tests, since this is documentation/evidence only.
- **Remaining merge gates:** normal review and required checks on the new evidence
  commit; do not claim the earlier run tested that newer SHA. Keep PR #81 draft.
  Dependency remediation requires a separate supported change if one becomes
  available; no override/major migration/audit-policy weakening is authorized here.

Raw audit reports, command output, default-cache diagnostic and official advisory
summary are retained in [audit follow-up evidence](evidence/task-18-audit-followup/).
The [validation JSON](evidence/task-18-validation.json) separates the historical
local record, new verification and completed external results.
