# Task 23 / H4 / W7–W8 / R1,R9,R10 validation

Scope: isolated database CI and consolidated release/rollback runbook only.
Fetched `origin/main` on **2026-10-20** before edits: actual base
**`323b2d5d956312b7973484b5e5c3f37c14afb9be`**, identical to the latest reviewed
main. `git log 323b2d5..origin/main` was empty. No subsequent changes required
reconciliation. Tasks 01–22 and PR #85 are the baseline. No applied migration,
application runtime, authentication, synchronization or metric contract is changed.
Final PR-head/checked-out SHAs and exact-head CI links are recorded in the draft PR;
a local dirty-worktree run keyed by base SHA does not certify that base's code.

## Requirements and evidence matrix

| Requirement | Existing implementation/evidence | Remaining gap | Task 23 change | Actual verification |
| --- | --- | --- | --- | --- |
| PR + main database gate / correct SHA | Workflow already triggers both; DB job restricted to PR head | Main skips DB; fallback expression/evidence absent | Remove PR-only condition; PR head or pushed SHA checkout, checked against event payload; retain merge event SHA separately | Event/mismatch/workflow regressions pass; actual PR CI recorded below/in PR; main-push execution remains unobserved until merge |
| Minimal secret-free isolated infrastructure | CLI 2.48.3, OS-temp local stacks, synthetic fixtures, env allowlist and dedicated variables | Application checkout persisted credentials; repeated full app tests in DB job | Both checkouts disable persisted credentials; keep read-only permissions/pins; compile test prerequisites once instead of rerunning app tests | Focused workflow/isolation regressions pass; no secret or dependency added |
| Preserve complete fresh/upgrade path | Task 22 reviewed full CI passed; baseline 20260519090000 and intermediate preservation already present | Extend without replacing | Reuse every existing migration/preservation/security/runtime suite on both paths | Local full attempt and exact-head CI outcomes are separate below; no PostgreSQL-only substitute |
| Exhaustive current schema security | Existing inventories and suites cover Tasks 11–21 | Additions/overloads/views could escape inventory; legacy function properties partly asserted | Closed discovery of 26 app tables, zero views and 49 function signatures; exclude extension-owned members; broader browser privilege checks and protected-state service TRUNCATE denial; shared PUBLIC/service/security/search_path validation for both legacy functions | SQL-generator/unit regressions pass; real rollback-only table/view/overload and prohibited service-TRUNCATE negative controls are part of full gate |
| Valid SQL/Data API denial/allowance | Exact object-specific 42501 assertions, service controls, Auth roles and limiter concurrency | Restore target has no independent Data API check | Reuse shared denial/allowance assertions for restored tables and read RPCs; preserve full source suites | Focused failure-propagation tests pass; real restore/security outcome requires completed full gate |
| Fail closed and distinguish infrastructure | Runner blocked Docker path already nonzero | Sparse partial evidence; raw child errors; unbounded child commands | Persist per-phase outcomes before execution; bound child processes; classify known capacity/image/transport/timeouts; no fallback/retry loop; require security completion report | Failure/classification/blocked-evidence tests pass; unavailable execution never counted passed |
| Sanitized evidence and owned cleanup | JSON results/failure/cleanup + pinned upload action | Event/tools, unfinished groups and cleanup verification incomplete | Identity, toolchain, migration and per-suite allowlisted reports; pending-before-action cleanup, verify absence of exact owned containers/volumes/networks; remove only invocation temp directory | Focused identity/outcome tests pass; actual infrastructure cleanup is reported per invocation |
| Current release/rollback entry point | Historical W1–Task 22 instructions spread across two docs and specialist guides | Short migration lists, stale auth rollback and incompatible writer advice | Replace current runbook, slim deployment index, explicit compatibility table/order/configuration/three recovery procedures; retain original dependency evidence with original scope | Source/config/migration/operator cross-review and diff checks; no production actions |
| Free-plan backup→restore | Task 20 requires tested restore; no consolidated rehearsal | No bounded app-state restore verification | Same runner adds separately owned Supabase target; source-matching pg_dump of public + migration history, in-memory restore, all-column/table equality, catalog + real Auth/Data API checks; no dumps uploaded | Orchestration failure-propagation unit tests pass; actual rehearsal outcome reported separately below |
| Separate remaining gates | Tasks 19–22 explicitly defer production/staging/cutover/scheduled evidence | Stale docs imply outstanding implemented work | Keep Task 24, actual production state/backup, authorized repair/cutover and two real scheduled cycles open; preserve cron and partial continuation | No external gate marked completed by documentation |
| Supported toolchain/audit provenance | Task 22 local Node 24/npm 11 failed remediation metadata while reviewed CI passed | Compare with CI Node 22 without policy/dependency edits | Node 22.23.3/npm 10.9.8 exact-lockfile checks; preserve historical discrepancy | Audit rerun passed unchanged: 8 high development entries, 0 production; first attempt failed ENOSPC, retained below |

## Coverage reused

The full runner still invokes existing `supabase-security`, `matter-sync-lease`,
`matter-page-commit`, `session-word-method`, `matter-continuation`, `matter-requests`,
`historical-preview`, `matter-status` and `historical-repair` integration suites on
**both** fresh and upgrade Supabase stacks. This preserves login limiter groups
(two × 20 concurrent calls), auth boundaries, stale lease fencing, atomic page and
rollup recovery, 601 word-method rows and ten false-tag page rejections, 5,000-session
continuation/reference, quota/retry contracts, read-only preview, >10,000-session
repair/cutover/rollback and truthful status evidence. These are required assertions,
not new claims that a particular execution passed. Existing historical results
retain original SHA/date in Tasks 19–22 documents.

The full 20-file chain is unchanged. The upgrade retains baseline legacy rows and
intermediate active stream/cooldown, lease generation/expiry, receipt/dirty work,
continuation/request, provenance, Task 20 generation and Task 21 status preservation.
No hosted credentials, Matter requests, production data or plain-PostgreSQL
replacement is used. The new restore checks compare every app table before and
after restore, including populated raw/progress and generation state, and again
after read-only Data API probes. Only owned Auth users are created/deleted there.

## Local commands (2026-10-20)

Final local toolchain matches observed CI: Node **22.23.3**, npm **10.9.9**,
Next **15.5.27**, unchanged lockfile. The initial pass used npm 10.9.8; all required
application commands were then rerun successfully on 10.9.9.
[Sanitized local command results](evidence/task23/local-validation.json).
The local command runner strips inherited application secrets and uses synthetic
build configuration. During implementation the checkout was dirty at base SHA;
committed exact-head verification is reported separately.

| Command | Actual result |
| --- | --- |
| `npm ci` | Passed, 456 locked packages; package.json/package-lock unchanged |
| `npx --no-install next typegen` | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed; changed orchestration/integration modules separately linted, zero errors |
| `npm run test` | Passed: **395 tests, 395 passed, 0 failed/cancelled/skipped/TODO**; ordinary opt-in database suite did not execute and is not counted as a database pass |
| Focused evidence/orchestration/catalog tests | **26 passed, 0 failed/cancelled/skipped/TODO** after final implementation edits; these are unit/orchestration checks, not database verification |
| `npm run build` | Passed; synthetic configuration, no live database/Matter access |
| `npm run audit:ci`, first attempt | Failed before audit, **ENOSPC** creating audit-results while Docker image extraction consumed disk; no advisory result from this attempt |
| `npm run audit:ci`, supported-toolchain rerun | Passed, unchanged policy: **8 high full-graph entries; low/moderate/critical 0; production 0**. No exception expanded or finding suppressed |
| `DISPOSABLE_DB_ACK=yes npm run test:stabilization-db` | Interrupted during image setup by the execution environment after recurring disk pressure; no stacks/assertions or restore completed. Automatic cleanup remained pending/unverified. A separate owned cleanup found no containers/volumes/networks, stopped the owned project and removed its exact temporary directory |
| Synthetic backup→restore | Included as required final phase of full runner; not counted passed unless executed/completed |
| `git diff --check` | Passed during implementation; repeat at final head |

The npm Supabase 2.48.3 installer exited 1 locally before producing a binary. The
same official release binary was downloaded and its published SHA-256 verified:
`1d71e2c3c5a14456c34d2f015e487f9256ac15f2cb70b821337253f2478483cb`.
An ignored local wrapper delegates **only** `npx --yes supabase@2.48.3` to that
binary; CI continues to use the unchanged pinned npm CLI. Actual `--version`,
`db dump --help`, `migration up --help` and `stop --help` were inspected. No new
CLI command from current docs is assumed available in this older pin.

Task 22's original Node 24.19.0/npm 11.9.0 `tailwindcss-animate.fixAvailable=true`
policy failure remains historical evidence at its original SHAs/dates. Node 22/npm
10's current pass is a new observation, not a relabeling of that failure or a
reason to weaken audit policy. Registry metadata is time-dependent; exact-head CI
must run the unchanged policy again.

## Initial CI correction (historical)

[Run 39423982024](https://github.com/dfalidas/matter-stats/actions/runs/39423982024)
at implementation `ce7bb844513d1c0710e022fd6481bcac692bc954` checked application
merge **`69a85a8581e4b6617d56cdf8068c56d95ce86036`**. Its unit suite failed the
Docker-unavailable fixture because it inherited the PR environment and attempted
the real DB-head identity check on that merge commit. The test now injects its own
explicit synthetic identity; the production runner still checks the actual event
commit. The focused suite passes under simulated PR environment variables. No real
identity assertion was weakened. The initial database job's separate result is
retained in the PR; final-head CI must rerun both jobs after this correction.

## Complete paths and first rehearsal attempt (historical, 2026-10-20)

[Run 39425193573](https://github.com/dfalidas/matter-stats/actions/runs/39425193573)
tested implementation **`ebfd2f931937110204aa1807f744c28849b8c3fc`** for the DB
job and application merge **`6b70f531973f6191f69a8511ebe527e2f5892ae1`**.
Application verification passed all required steps, **395/395 tests**, no
failures/cancellations/skips/TODO, build and unchanged audit (8 high development
entries, zero production vulnerabilities), Node 22.23.3/npm 10.9.9.

The [DB artifact](https://github.com/dfalidas/matter-stats/actions/runs/39425193573/artifacts/12266940987)
was downloaded and its JSON independently inspected. Both **fresh AND upgrade**
completed all original suites, all 20 migrations, the closed catalog and
preservation. The overall database job **FAILED** its new backup/restore phase:
**28 passed / 1 failed / 0 skipped / 0 TODO / 0 blocked / 0 not-run** phase groups.
All three owned stacks were **verified removed** and the temporary root removed.
No successful backup/restore or complete database gate is claimed for this attempt.

Source inspection identified a fixture collision: existing real-runtime suites
can leave a scheduled invocation row, while the first restore seed unconditionally
inserted that singleton key. The seed now uses the existing bounded invocation
RPC to record its synthetic attempt/result. Restoration explicitly requests the
documented PostgREST schema reload. The runner also checks service-role TRUNCATE
restrictions on every protected additive table, including generations, with a
rollback-only prohibited-grant negative control. A shared subphase recorder now
retains target/seed/snapshot/dump/restore/preservation/catalog/Data API outcomes;
SQL failures retain only SQLSTATE, not secret-bearing raw stderr. Metadata child
processes use the same existing environment allowlist. Focused checks: **26 passed**,
including failed-stage propagation and simulated PR metadata.

These corrections require a new complete exact-head CI run. **The latest acceptance
run, actual checked-out head/merge SHAs, outcomes/counts and artifact links are
maintained in [draft PR #86](https://github.com/dfalidas/matter-stats/pull/86).**
The historical failure above is never relabeled; an earlier head's artifact does
not certify the final head. Main-push execution still requires a separately
authorized merge, and no staging/production gate is closed by CI alone.

## Final-head attempt history before restore correction

At `0649d73c2e1d3905195c350e5e6965759430160c`, local and application CI
passed **397 tests**, zero failed/cancelled/skipped/TODO. Application CI actually
checked merge `55186e21987aeb6fcb5621f242becc01306f7783`, Node 22.23.3/npm 10.9.9.
[Run 39427897430 attempt 1](https://github.com/dfalidas/matter-stats/actions/runs/39427897430/attempts/1)
blocked on image pull before assertions (**4 passed / 1 blocked / 24 not-run**
phase groups); cleanup passed. Its [artifact](https://github.com/dfalidas/matter-stats/actions/runs/39427897430/artifacts/12266312702)
was downloaded and inspected. One bounded rerun of only the failed DB job followed.

[Attempt 2](https://github.com/dfalidas/matter-stats/actions/runs/39427897430/attempts/2)
completed both full database paths, including the new prohibited-TRUNCATE negative
control. Restore then failed with **SQLSTATE 42P01**. The [inspected artifact](https://github.com/dfalidas/matter-stats/actions/runs/39427897430/artifacts/12268615339)
records target, seed, snapshot and dump passed; restore failed; preservation/catalog/
Data API not run (**4 / 1 / 3**, separate from global **28 passed / 1 failed**).
All three stacks and the temporary root were verified removed. This is an actual
restore failure, not an infrastructure pass or completed backup/restore gate.

The rehearsal now runs after fresh schema/catalog prerequisites, before the longer
integration suites. Its owned source is reset through the same complete fresh
migration path before those suites; upgrade intermediates and every suite remain
required. The restore target is removed before upgrade begins. Failure evidence
includes a constrained missing-relation identifier alongside SQLSTATE; no raw dump
or arbitrary database stderr is retained. Final-head outcomes remain linked in PR #86.

## Restore protocol correction

[Run 39431946867](https://github.com/dfalidas/matter-stats/actions/runs/39431946867)
at `9b1b57ca4653c99a01591e07181ff9306c440976` identified the missing relation as
`public.matter_sync_streams` during destination restoration, SQLSTATE 42P01.
No restore, preservation or Data API pass is inferred from this failure.

The corrected procedure dumps the two explicitly selected schemas without clean
commands and loads them into a guarded new Supabase destination. Preparation
refuses any app-owned public object or applied migration before replacing its
initial schemas; a real SQL negative control must reject the populated source.
All errors still stop and roll back restoration. Source data/progress comparisons,
exact catalog and real Data API checks remain required. Backup evidence now records
only schema scope, byte count and SHA-256 identity, never the dump. Source and
restore target are still separately owned local stacks, with full fresh/upgrade
verification following the prerequisite. Final acceptance evidence is linked in PR #86.

## Guarded-restore prerequisite blocker

[Run 39433255802](https://github.com/dfalidas/matter-stats/actions/runs/39433255802)
at `43283ddeff3169e159349bd5f828982541a35618` blocked before stack creation when
Docker info exceeded the original ten-second probe limit. Its [inspected artifact](https://github.com/dfalidas/matter-stats/actions/runs/39433255802/artifacts/12269900018)
records `realDatabaseVerification=false`; no restore or security pass is claimed.
The single local-socket probe now allows a bounded thirty seconds and records a
specific timeout reason. No retry loop, alternate database or assertion fallback
is introduced. The empty-target protocol still requires actual successful execution.

## Project-role restore correction

[Run 39435890484](https://github.com/dfalidas/matter-stats/actions/runs/39435890484)
at `6d87aa196a388f01da891f6c4d92c25e0f8e2503` retained SQLSTATE 42501 and safe
catalog metadata: role/database owner `postgres`, standard public schema owner
`pg_database_owner`. Its [artifact](https://github.com/dfalidas/matter-stats/actions/runs/39435890484/artifacts/12271561113)
was downloaded and inspected; target guard/seed/snapshot/dump passed, restore failed,
and downstream restore checks did not run. Cleanup passed. No privileged bypass is
introduced to turn that failure green.

The current procedure uses the exact CLI 2.48.3 native schema/data export filters,
retains the platform public schema, refuses any destination migration object,
and restricts the restoring role's default grants before loading source ACLs.
Migration history is exported explicitly; the data export handles replica mode
and reset. Every app field, catalog property, actual Data API denial/allowance,
source rejection and owned cleanup still must pass. Exports remain in memory in
CI; the Free-plan operator procedure uses private files with a quiescent source.
Current-head acceptance evidence remains linked in PR #86.

## Evidence, impact and rollback

The obsolete initial run is superseded by the corrected head; a cancelled/incomplete
database job is never counted as passed.

CI artifact: `stabilization-db-<PR-head-or-main-sha>-<attempt>`, retained 14 days.
Inspect `identity.json`, `ci.json`, `toolchain.json`, per-path migration/suite files,
`outcomes.json`, `results.json` or `failure.json`, `backup-restore.json` if completed,
and `cleanup.json`. Never substitute a previous head's artifact. Counts in
`outcomes.json` are verification **phases**, not individual unit tests/assertions;
blocked, not-run, skipped, TODO and interrupted running remain distinct.

Runtime/data/dependency/configuration impact: **none on the application**. CI now
runs the existing local Supabase gate on main pushes and adds a bounded synthetic
restore target; integration compilation remains required. No migrations or new
secrets, paid services, cron changes or application env names. Only test-owned
synthetic data and local disposable resources are created. Specialist operator
interfaces remain isolated-only; no production capability is enabled.

Rollback for this PR is an application-neutral revert of CI/tooling/docs to the
base (which reintroduces the main-push verification/documentation gaps); retain
all database migrations, raw data, progress and status/generation history. No
production SQL, state reset, RLS disabling or database rollback is needed.

Remaining gates: final-head review/checks and merge approval; main-push execution
observed after an authorized merge; **Task 24 staging end-to-end**; actual production
schema/config/runtime and validated production backup/restore; separately approved
preview/invalid-data policy/repair/cutover; two real scheduled cycles. Branch
protection recommended names are `verify` and `Fresh and upgrade database
verification`; enforcement was not configured or claimed. Automatic Vercel Git
statuses do not certify production. Partial sync may continue through existing
durable continuation; no reset or complete historical-coverage claim is made.
