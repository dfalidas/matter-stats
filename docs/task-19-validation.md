# Task 19 validation and remaining gates

Base: `e69b2f342eba91a6b0530a10e317c768349eaeed` (latest fetched origin/main,
2026-10-14, PR #81). No subsequent main changes existed at initial inspection.
Tasks 01–18 remained the starting implementation. The final tested head and
exact final command results are recorded in the draft PR; evidence files are
keyed by `git rev-parse HEAD` and the supplemental runner records dirty state.
A SHA recorded during development with a dirty worktree is **not** proof that
that committed SHA contains the tested Task 19 code.

## Checks and observations

| Check | Status | Evidence / limit |
| --- | --- | --- |
| `npm ci` | PASSED | Exact existing lockfile; dependency versions and audit policy untouched. |
| Next route `typegen` | PASSED | Next 15.5.27 route types generated before typecheck. |
| `npm run typecheck` | PASSED | Includes new provenance types; repeat at final head. |
| `npm run lint` | PASSED | Zero errors; four existing warnings in `.agents/skills/visual-explainer` and `lib/overview-service.ts`. |
| `npm run test` | PASSED | 343 tests in development rerun; final-head count/results in draft PR. First run had one outdated exact normalizer expectation, corrected to include explicit method. |
| `npm run build` | PASSED | Production Next build, static/dynamic route generation. |
| `npm run audit:ci` | PASSED latest development rerun; one intermediate FAILED | Full: seven high development findings deriving from GHSA-vfj7-8cjw-p6xm; production: zero. One response reported `tailwindcss-animate.fixAvailable=true`, so the unchanged enforcement correctly failed. The subsequent response passed with no compatible remedy. Record this changing registry remediation metadata rather than concealing the failed run or weakening enforcement. Recheck final head and review if it recurs. |
| `git diff --check` | PASSED | No whitespace errors. |
| Focused real PostgreSQL 17 fresh/upgrade | PASSED | Pinned image, all migrations, catalog/RLS/ACL/signatures, original-column upgrade preservation, NULL provenance even when words equal canonical, production writer metadata and false-tag rejection, preview/CLI/source concurrency/preservation and owned cleanup. Supplemental SQL gate only. |
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
reviewed final SHA. Investigate any recurring audit-remediation metadata failure;
do not bypass it. Production reader provisioning, production preview, migration
and deployment remain separately authorized later operations. Task 20 must
resolve invalid/unavailable baselines, implement its repair/catch-up/cutover and
rollback semantics, and obtain production approvals. This PR stays **draft** and
is neither merged nor deployed.
