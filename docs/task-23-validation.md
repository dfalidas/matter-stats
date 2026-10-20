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
| Exhaustive current schema security | Existing inventories and suites cover Tasks 11–21 | Additions/overloads/views could escape inventory; legacy function properties partly asserted | Closed discovery of 26 app tables, zero views and 49 function signatures; exclude extension-owned members; broader browser privilege checks; shared PUBLIC/service/security/search_path validation for both legacy functions | SQL-generator/unit regressions pass; real rollback-only table/view/overload negative controls are part of full gate |
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

Node **22.23.3**, npm **10.9.8**, Next **15.5.27**, existing unchanged lockfile.
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
| Focused evidence/orchestration/catalog tests | **24 passed, 0 failed/cancelled/skipped/TODO** after final implementation edits; these are unit/orchestration checks, not database verification |
| `npm run build` | Passed; synthetic configuration, no live database/Matter access |
| `npm run audit:ci`, first attempt | Failed before audit, **ENOSPC** creating audit-results while Docker image extraction consumed disk; no advisory result from this attempt |
| `npm run audit:ci`, supported-toolchain rerun | Passed, unchanged policy: **8 high full-graph entries; low/moderate/critical 0; production 0**. No exception expanded or finding suppressed |
| `DISPOSABLE_DB_ACK=yes npm run test:stabilization-db` | Local attempt pending at initial PR preparation; actual final outcome will be recorded in the PR/updated evidence. No assertions or restore pass inferred from setup |
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

## Evidence, impact and rollback

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
