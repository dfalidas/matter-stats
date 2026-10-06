# Task 12 review evidence

Scope: **Task 12 / E2 / W4 / R4 only**. Base main was checked through GitHub on
2026-10-05 and was `beb8ad7a7086cf65b6bf7dc3448646a2e2109fcb` (PR #73).
It matched the supplied baseline; there were no later main changes to reconcile.
Branch: `codex/task-12-account-lease-fencing`. Final SHA is the PR head commit.

## GitHub verification gate (2026-10-06)

PR: [#74](https://github.com/dfalidas/matter-stats/pull/74).
The original head `74a981dc3f8fd46973dff5f0c11039e0ef8b5cb9` passed
[regular CI](https://github.com/dfalidas/matter-stats/actions/runs/37350032265/job/111898264467):
226 tests, 223 passed, 0 failed/cancelled/skipped, 3 pre-existing TODO;
production audit then contained zero vulnerabilities. That run did not execute
the disposable databases.

The new PR-only **Fresh and upgrade database verification** job uses a
GitHub-hosted Ubuntu runner with Docker, checks out the exact PR head with
checkout credentials disabled, installs Node.js 22 and the lockfile, and runs:

```sh
DISPOSABLE_DB_ACK=yes npm run test
```

The acknowledgement adds the existing CLI **2.48.3** disposable runner after the
unit suite. Without it, `npm run test` remains database-free. An invalid
acknowledgement fails closed; a blocked runner exits nonzero. Both fresh and
upgrade paths use only owned OS-temporary local Supabase stacks, sanitized child
environments and synthetic fixtures. No production secrets, external database
connection or real Matter request is configured. SQL/Data API concurrency,
stale-worker fencing, security and actual runtime import/rollup paths are the
existing integration suites, rather than replacement mocks.

The always-run artifact step retains only JSON under
`artifacts/stabilization-db/<tested-sha>/`, including a known-field `ci.json`
even when setup or the test step fails. Runner reports record migration history,
path results, lease acceptance checks, legacy/Task 11 preservation and owned
stack cleanup. Arbitrary subprocess error text is excluded from failure/cleanup
JSON; detailed failures remain in the job log. Missing evidence fails upload.

| Tested PR head | Regular CI | Database gate |
| --- | --- | --- |
| `11c37541e5d92e6a5f10830c39c7493d13d75253` | [Run 37438130816, verify](https://github.com/dfalidas/matter-stats/actions/runs/37438130816/job/112184910717): install, typegen, typecheck, lint, 223 passed / 3 TODO, build passed; audit failed. | [Database job](https://github.com/dfalidas/matter-stats/actions/runs/37438130816/job/112184911017): failed at the fresh lease fixture's JSON key-order comparison; catalog and existing security suite had completed. No fresh/upgrade pass claimed. |

That first real execution exposed a fixture comparison bug: JSONB returned
library filter keys in PostgreSQL's order, whereas the fixture used
`JSON.stringify` equality. The fixture now requires strict structural equality
and still rejects missing, changed or extra filters; a regression covers these
cases. The
[failure artifact](https://github.com/dfalidas/matter-stats/actions/runs/37438130816/artifacts/11399629751)
was retained, including owned-stack cleanup evidence.

The new audit report has one high production finding in `source-map-js`,
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
The full report has 11 entries: 8 high, 3 moderate, 0 low/critical.
[Retained reports](https://github.com/dfalidas/matter-stats/actions/runs/37438130816/artifacts/11400560063)
were inspected. The existing zero-production-findings policy and dependency
files are unchanged; dependency remediation is outside this verification-only
follow-up.

## Original local execution (historical)

| Check | Actual local result |
| --- | --- |
| Lockfile install | Passed: `npm ci --no-audit --fetch-retries=0`, after an offline attempt lacked a cached package. No dependency/lockfile changes. |
| Route type generation | Passed: `npx --no-install next typegen`. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm run build` | Passed; production compilation, route generation and build completed. |
| `git diff --check` | Passed. |
| `npm run test` | Did not pass: native `spawnSync git` returned EPERM, and the existing fake-psql subprocess stalled. The owned run was stopped; its file-level aggregate was 24 passed, 1 failed, 3 cancelled, 0 skipped, 0 TODO (28 test files). These are file counts, not assertion counts. |
| Supplemental isolated test-file runs | 211 assertions: 208 passed, 0 failed, 3 pre-existing TODO, 0 skipped. Each compiled application test and the audit/auth/sync/security assertion/fixture suites was executed in its own Node process. |
| Supplemental pure runner/catalog tests | 10 assertions passed (4 catalog, 6 orchestrator), 0 failed, 0 TODO, 0 skipped. Five subprocess-dependent tests were outside these filtered runs and remain unverified locally. |
| `npm run audit:ci` | Failed execution gate: `spawnSync npm EPERM`. No valid vulnerability report/counts were obtained; this is not a passed audit or a waived advisory. |
| `DISPOSABLE_DB_ACK=yes npm run test:stabilization-db` | **BLOCKED** at `spawnSync git EPERM`, before provisioning. The managed Docker socket was also inaccessible in the sandbox. Neither fresh nor upgrade database/security/lease verification ran. No real DB fencing evidence is claimed. |

The combined supplemental runs completed **221 assertions: 218 passed, 0 failed,
3 TODO, 0 skipped**. They do not replace the failed/blocked full test command,
audit or real SQL/Data API gate. The three retained TODOs cover R3 continuation,
the R4 real integration target (blocked until executed), and R5 query pagination.
The first supplemental combined-process attempt exposed test environment sharing;
it was superseded by separate-process runs, which passed without auth changes.

Supabase CLI `migration new` was attempted twice using the runner's pinned CLI
2.48.3; CLI postinstall failed. The additive migration file was consequently
written directly with timestamp `20261005000000`, after both Task 11 migrations.
No previously applied migration was edited. No production SQL, real Matter sync,
secret rotation, deployment or merge was performed.

Before release, execute the normal checks and both disposable paths in an
environment with working subprocess/Docker/CLI prerequisites. The runner now
contains real parallel SQL/Data API acquisitions, typed production mutation RPC
fencing, a SQL lock/commit barrier, real import/enrichment/rollup paths with only
Matter HTTP simulated, delayed success/429 takeover tests, auth-role controls,
and Task 11 upgrade-state preservation. Their presence is implementation and
test preparation; their execution is an explicit pending gate.

Apply `20261005000000_matter_account_lease_fencing.sql` after
`20261004010000_preserve_sync_cooldown_and_window.sql` and before Task 12 runtime.
It adds one lease table/row and 14 invoker functions/helpers, with no rewrite of
existing rows or new configuration. TTL is fixed at 120 seconds (SQL bounds
30–300). The ownership contract and every mutation boundary are inventoried in
[architecture.md](architecture.md#account-lease-and-fencing-task-12--e2--w4--r4).
For rollout and rollback, block and drain all old/new writers before switching
runtime versions, keep old unfenced deployment URLs/jobs disabled, and retain the
durable generation row. An additive migration alone does not fence old code.

Task 13 remains the whole-page/checkpoint/dirty-rollup-marker transaction;
Tasks 14–15 remain continuation/backfill/shared quota. Earlier valid mutation
transactions can remain committed after a later failure, and abandoned run
reconciliation remains outside this change.
