# Task 19 validation and remaining gates

Base: `e69b2f342eba91a6b0530a10e317c768349eaeed` (latest fetched origin/main,
2026-10-14, PR #81). No subsequent main changes existed at initial inspection.
Tasks 01–18 remained the starting implementation. Runtime implementation tested at clean SHA `8f627fda896084c4472ec46157300d40dd17fd20`.
The final documentation-only head and exact command results are recorded in the draft PR; evidence files are
keyed by `git rev-parse HEAD` and the supplemental runner records dirty state.
A SHA recorded during development with a dirty worktree is **not** proof that
that committed SHA contains the tested Task 19 code.

## Historical local checks (retained, superseded by verified CI where applicable)

| Check | Status | Evidence / limit |
| --- | --- | --- |
| `npm ci` | PASSED | Exact existing lockfile; dependency versions and audit policy untouched. |
| Next route `typegen` | PASSED | Next 15.5.27 route types generated before typecheck. |
| `npm run typecheck` | PASSED | Includes new provenance types; repeat at final head. |
| `npm run lint` | PASSED | Zero errors; four existing warnings in `.agents/skills/visual-explainer` and `lib/overview-service.ts`. |
| `npm run test` | PASSED | 343 tests in development rerun; final-head count/results in draft PR. First run had one outdated exact normalizer expectation, corrected to include explicit method. |
| `npm run build` | PASSED | Production Next build, static/dynamic route generation. |
| `npm run audit:ci` | FAILED at clean implementation SHA; earlier PASSED responses | Full: seven high development findings deriving from GHSA-vfj7-8cjw-p6xm; production: zero. One response reported `tailwindcss-animate.fixAvailable=true`, so the unchanged enforcement correctly failed. The subsequent response passed with no compatible remedy. Record this changing registry remediation metadata rather than concealing the failed run or weakening enforcement. It recurred at the clean implementation SHA; this historical local response is retained. Reviewed GitHub CI later passed the unchanged audit policy, so this response alone does not require a dependency upgrade. |
| `git diff --check` | PASSED | No whitespace errors. |
| Focused real PostgreSQL 17 fresh/upgrade | PASSED at clean implementation SHA on rerun | Pinned image, all migrations, catalog/RLS/ACL/signatures, original-column upgrade preservation, NULL provenance even when words equal canonical, production writer metadata and false-tag rejection, preview/CLI/source concurrency/preservation and owned cleanup. Supplemental SQL gate only. First final-head invocation exited nonzero with generic failure; diagnostic and unchanged official reruns passed, with clean worktree and owned cleanup. The first failing layer remains unidentified. |
| Full `DISPOSABLE_DB_ACK=yes npm run test:stabilization-db` | FAILED setup / BLOCKED database evidence | At base HEAD with Task 19 dirty worktree: fresh startup never created its stack; image extraction failed `no space left on device`. The runner wrote sanitized failure/cleanup evidence, with automatic stack cleanup marked FAILED. No stack containers remained. Upgrade/Data API/real browser HTTP/page/ack regressions did not execute; do not count them as passed. |
| Production read preview, migration, sync, deployment | NOT EXECUTED | Explicit assignment boundary. |
| Task 20 repair/shadow/catch-up/cutover/rollback | TODO / OUT OF SCOPE | Handoff in the operator guide. |

Full Supabase CLI npm installer initially failed. The official **same pinned
2.48.3** release was downloaded with verified TLS and used for migration
creation. Its binary was made available in an isolated ignored npm-exec cache to
run the unchanged orchestrator. No repository dependency, lockfile, CLI pin or
audit enforcement was changed. Docker's vfs-backed image extraction capacity,
not a passing mock test, blocked the full stack. The smaller digest-pinned
PostgreSQL gate is deliberately identified as supplemental; it is not a
substitute for actual PostgREST/Supabase grants or migration-history execution.

## Acceptance evidence

Independent expected assertions include three 60-second sessions = **675**, three
1-second sessions = **12**, and 10,003 one-second tied sessions plus a 60-second
midnight session = **40,237**. Zero durations count as sessions with zero words;
unlinked sessions retain all reading metrics. A 7,200-second session beginning
before local midnight stays entirely on its occurrence date.

The [synthetic JSON](evidence/task19-synthetic.json) and
[human summary](evidence/task19-synthetic.txt) distinguish persisted session
words, proposed duration-based estimates and old rollups. They include UTC→Athens
midnight/Monday/month/year reassignment, both DST transitions, known/unknown
provenance, missing rollups and obsolete dates that become empty. Invalid
null/negative durations and invalid/missing timestamps are separately counted;
an invalid recorded provenance timezone has its own reason and unavailable
explanation. They never become valid zero-duration sessions. The committed data
are wholly synthetic and contain no source session identifiers or credentials.

The real SQL suite fingerprints every inventoried database table independently
before/after preview, including status/lease/checkpoint/marker state, and verifies
no column or count changed. Its source fingerprints include every stored session
and daily column. A separate connection updates/inserts sessions and changes a
rollup after snapshot acquisition; every preview pass still agrees with the
original repeatable-read snapshot. Repeated preview produces identical daily and
monthly values. A real write attempt in the transaction mode is rejected; real
query errors and unit transport/count/sentinel/fingerprint failures reject
completion. The actual operator CLI is exercised with a dedicated synthetic
libpq service and produces both JSON and text, including exit 2 for invalid-row
incompleteness. COPY avoids Data API caps entirely; existing Task 16–18 actual
HTTP low-cap/pagination/tie regressions remain in the application test run.

## Official mechanisms reviewed on 2026-10-14

- [Supabase changelog index](https://supabase.com/changelog.md) and
  [15.19 / 17.11 notes](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes):
  extension/index/encryption changes do not introduce a mechanism used by this PR;
  no production minor-version state is inferred.
- [Database functions](https://supabase.com/docs/guides/database/functions),
  [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api),
  [Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres):
  retain explicit server-only grants, invoker functions, connection/session semantics.
- PostgreSQL [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html),
  [SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html),
  [COPY](https://www.postgresql.org/docs/current/sql-copy.html),
  [row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
  [psql](https://www.postgresql.org/docs/current/app-psql.html):
  repeatable snapshot, READ ONLY, COPY TO streaming, RLS-filter rejection,
  startup-file exclusion and ON_ERROR_STOP.

## Remaining gates

Run the full owned Supabase fresh/upgrade stacks on an executor with enough image
storage and retain successful Data API/security/page/ack/cleanup evidence at the
reviewed final SHA. Reviewed CI passed audit; do not infer a required dependency upgrade solely from the earlier local response. Preserve the unchanged audit policy and verify it at the final implementation head. Production reader provisioning, production preview, migration
and deployment remain separately authorized later operations. Task 20 must
resolve invalid/unavailable baselines, implement its repair/catch-up/cutover and
rollback semantics, and obtain production approvals. This PR stays **draft** and
remains unmerged. Existing Vercel GitHub integration automatically created preview deployments on branch pushes; no production promotion or deployment command was invoked.

## Reviewed GitHub CI: completed outcomes

[Run 38540720490](https://github.com/dfalidas/matter-stats/actions/runs/38540720490)
tested `add62d3b9aabaf08b86d06198f42754d44299ebc`:

- **PASSED:** verify job, locked install, route types, typecheck, lint, **343 tests**,
  production build and unchanged audit policy.
- **FAILED:** full fresh/upgrade database job reached `matter-continuation.mjs`;
  first `commit_matter_page` returned HTTP 400 / PostgreSQL **23514**, with
  `pagesCommitted=0`. Upgrade and downstream preview verification did not run.
  This is an actual integrity-check failure, distinct from the earlier local
  Docker capacity blocker. The status is completed failure, not “CI pending”.

## Arithmetic defect and unchanged contract

The original draft CHECK evaluated `floor(seconds::numeric / 60 * 225 + 0.5)`.
PostgreSQL numeric division has a finite result scale; its decimal intermediate
is not the JavaScript binary64 division/multiply intermediate. Even rational
arithmetic or reordering to `seconds * 3.75` would change the established contract.

A real PostgreSQL reproduction applied the reviewed migration and submitted the
first 100 production-normalized continuation rows to the actual fenced page
function. It rejected **`history-repro-2`**, the `i=2` continuation row (duration
**2 seconds**, occurrence `2026-12-30T10:00:00Z`, words **8**, unlinked, method
`session-duration-225-round-v1`), under **`session_word_method_valid`**, SQLSTATE
**23514**. PostgreSQL's diagnostic included that failing row. The transaction
left **zero** session rows. In the original fixture its ID is
`history-<synthetic UUID>-2`; no production identifiers are involved.

| Seconds | PostgreSQL old numeric intermediate | Old CHECK expects | JavaScript binary64 intermediate | Canonical words |
| --- | --- | --- | --- | --- |
| 2 | 7.49999999999999999925 | 7 | 7.5 | 8 |
| 6 | 22.50000000000000000000 | 23 | 22.5 | 23 |
| 130 | 487.5000000000000075 | 488 | 487.49999999999994 | 487 |
| 246 | 922.5000000000000000 | 923 | 922.4999999999999 | 922 |
| 262 | 982.5000000000000075 | 983 | 982.4999999999999 | 982 |

The corrected CHECK explicitly uses `double precision` for **division first,
then multiplication** and computes `floor(x) + (fraction(x) >= 0.5 ? 1 : 0)`.
It does not use `round(float8)` (ties can select even, e.g. 6 seconds → 22), nor
`floor(x + 0.5)` (the addition can introduce another floating-point rounding).
Canonical tags still require exact equality, non-null words and non-negative,
non-null duration. There is no tolerance, OR-with-legacy-formula or removed CHECK.
The JavaScript formula, operation order, WPM and method version are unchanged.
Only the **unmerged, production-unapplied Task 19 draft migration** is amended;
no applied main migration is rewritten and no production SQL is executed.

New full-runner `tests/integration/session-word-method.mjs` checks actual
PostgreSQL intermediates against independent JS references at all five requested
boundaries. All **601** normalizer outputs for **0–600 seconds** must persist
through **7** real fenced **Data API** page transactions. At the five boundaries,
canonical words ±1 must fail **10** page transactions with HTTP 400 / 23514 /
`session_word_method_valid`, preserving rows, checkpoint, receipt and dirty
revision even with a valid preceding row in the page. The existing continuation
suite additionally checks an independent JS word vector and version for every
one of its **5,000** stored sessions. These checks join the existing security,
lease, page recovery, rollup acknowledgement, continuation, shared quota and
preview suites on **both fresh and upgrade** stacks. Supplemental SQL acceptance
alone does not satisfy this gate. Final exact tested SHA/run outcomes are in the
PR description and execution evidence; failed historical checks above are retained.

Official documentation rechecked for this fix:
[PostgreSQL numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html),
[math functions and rounding](https://www.postgresql.org/docs/current/functions-math.html),
[ECMAScript Math.round](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.round),
and the current Supabase changelog. PostgreSQL documents numeric/inexact-float
and differing tie behavior; ECMAScript explicitly warns that `floor(x + 0.5)`
can differ. Real Linux PostgreSQL and runtime tests supply platform evidence.

## First fix CI diagnostic result (retained)

[Run 38545787503](https://github.com/dfalidas/matter-stats/actions/runs/38545787503)
tested `ef3bb0e0080abbfbcefa7f3723abd18da6a05073`: application verification
**PASSED**, including **344 tests** and audit. The database job failed in the
new word-method diagnostic before acquiring its fixture lease: parsing
PostgreSQL's text-formatted intermediate yielded `487.5`, while JavaScript's
binary64 value is `487.49999999999994`. Supabase's configured float text precision
can hide that distinction; it is not evidence that the stored internal value or
corrected CHECK differs. The test now compares `encode(float8send(x),'hex')` with
JavaScript DataView's big-endian float bytes. This is an exact equality test with
no tolerance. Canonical expected words and false-tag rejection remain unchanged.
The full fresh/upgrade suite must rerun after this diagnostic correction.

The repeated local full-runner attempt again failed at stack image setup and
cleanup under storage pressure, and two local builds reported ENOSPC while
Docker image extraction was underway. Local audit again returned the earlier
remediation-metadata failure; **both reviewed and first-fix GitHub CI passed
that unchanged audit policy**. These local failures are retained without inferring
a dependency-upgrade requirement solely from them.
