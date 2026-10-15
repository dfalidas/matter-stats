# Task 21 validation

Base: `18985cc639c03c5de6cd28d366bbaed7d90f142b` (fetched main, no subsequent commits). Final code and PR-head SHAs are recorded in the draft PR, along with final-head CI links/outcomes. No production actions are part of validation.

## PR #84 review correction: latest invocation evidence

Fetched/reviewed PR head: `0bc90d7dd8a5356ee51be0f3e8ca429853b0471a`. The worktree was clean and the remote had no subsequent changes. Runtime and regression tests are committed/tested at **`ab71fdb56f73a86c1e033ef9fb03005615c3bf49`** on the existing `task21-truthful-status` branch. The final evidence-only head and its CI results are recorded in [draft PR #84](https://github.com/dfalidas/matter-stats/pull/84). Machine-readable results: [review-validation.json](evidence/task21/review-validation.json).

**Root cause:** `deriveSyncStatus` preferred any audit row over all run rows, so an older successful audit masked a newer error or unfinished run when its best-effort audit write failed. Audit and lease/run UUIDs were also generated independently, preventing trustworthy correlation during normal audit-before-run ordering.

**Correction:** compare both evidence sources, correlating only identical UUIDs. One random invocation UUID is recorded before acquisition and supplied as the lease owner; the existing fenced run RPC already stores that owner as the run ID. Generation, scope, TTL, lease validation and all mutation fences are unchanged. Matching records use the audit attempt time and retain its proven trigger/final outcome; an initial-only audit uses the correlated run's outcome. Conflicting terminal evidence is explicit. Independent newer run evidence takes precedence over an older audit and retains unknown trigger and run-log provenance. A newer audit-only lock/rate skip wins over an older correlated invocation even when that run was created later. Equal/invalid or indistinguishable sub-millisecond timestamps are uncertain, without proximity matching. Either source failing leaves available observations visible but labels the latest attempt unknown. Two latest run rows detect tied starts, while the three per-trigger audit rows and eleven total status queries remain bounded. No audit/run IDs leave the selector, and manual feedback uses exactly the same formatted attempt detail as Overview and Settings.

**Passed at the runtime SHA above** (local Node **24.19.0**, npm **11.9.0**, registry `https://registry.npmjs.org/`; fresh writable task-local npm cache):

| Command | Result |
| --- | --- |
| `npm ci` | Exit 0; 456 packages, unchanged lockfile. |
| `npx --no-install next typegen` | Exit 0; prerequisite completed before typecheck. |
| `npm run typecheck` | Exit 0. |
| `npm run lint` | Exit 0; zero errors, three existing local `.agents/skills/visual-explainer` warnings. |
| `npx --no-install tsc -p tests/tsconfig.json` and focused status/surface/entrypoint/lease tests | Exit 0; **43 passed / 0 failed / 0 skipped**. |
| `env -u DISPOSABLE_DB_ACK npm run test` | Exit 0; **373 passed / 0 failed / 0 skipped / 0 TODO**. The opt-in database runner was not enabled. |
| `npm run build` | Exit 0; synthetic server configuration, no live database or Matter access. |
| `npm_config_cache=<task-local-cache> npm run audit:ci` | Exit 0; **0 production vulnerabilities**, **7 high full-audit entries**, covered by unchanged development-only exception `GHSA-vfj7-8cjw-p6xm`. No policy/dependency changes. |
| `git diff --check` | Exit 0. |

Regression evidence covers older success plus newer error/unfinished run; normal shared-ID audit-before-run ordering; an unfinished audit with a terminal run; conflicting outcomes; newer audit-only locked/rate-limited skips; equal audit/run and run/run timestamps; invalid/sub-millisecond timestamps; independent query failures; bounded actual Supabase queries; actual Overview/Settings/manual action agreement across ten scenarios; canonical totals and identifier privacy. The actual sync entrypoint proves audit-before-lease-before-run ordering with one UUID even when audit writes fail. The actual lease helper proves unchanged RPC scope/TTL and exact BIGINT generation, and distinct generated UUIDs for default callers.

**Failed/blocked checks:** none in this correction's local required checks. An initial restricted Node test runner reported only file-level passes; those results were discarded and the targeted/full suites were rerun with permitted process/network settings, yielding the individual counts above.

**Not rerun locally:** fresh/upgrade/security databases (no schema, RPC, grant or migration changes) and the earlier browser screenshot matrix. Existing CI still enforces its full isolated database harness; new-head CI is a merge gate until it completes. Prior successful workflow [38754563583](https://github.com/dfalidas/matter-stats/actions/runs/38754563583) belongs to PR head `0bc90d7dd8a5356ee51be0f3e8ca429853b0471a`: application verification actually checked generated merge `e1c26c103892f59ba1fa5a9d45c9c78717fc9c29` (363 tests), while fresh/upgrade SQL + Data API checks tested head `0bc90d7dd8a5356ee51be0f3e8ca429853b0471a` (artifact `11983413623`). Those results and the browser source `8153524e90730bfa74cb658f1bb961e872729cd3` remain historical evidence, not verification of this correction. The original local Docker storage blocker below is preserved.

Independent audit/run reads can still observe adjacent committed states; they do not form an MVCC snapshot. Audit writes remain best effort and the per-trigger record can be superseded; unrecorded attempts remain unknown and legacy/different UUIDs have no inferred trigger. No cycle completion/readiness, metric, authentication, quota, retry, continuation or generation semantics change. Rollback is application-only and would reintroduce this selection defect; no schema rollback is needed. PR #84 remains draft, open and unmerged. No production SQL, sync, repair, rotation or deployment was performed.

## Earlier local commands and evidence (historical)

- `npm ci`: passed, exact unchanged lockfile, 456 packages; Node 24.19.0 / npm 11.9.0 in the managed workspace. CI uses the repository's Node 22 setup.
- `npm run test`: 362 tests passed, zero failures/skips at runtime source `320f235`, including configured-timezone feedback, shared surfaces and metric/CSV/payload regressions. Final-head CI reruns the full suite and extended integration fixtures.
- `npm run typecheck`: passed.
- `npm run lint`: passed (zero errors; three pre-existing local `.agents/skills/visual-explainer` warnings, outside changed files).
- `npm run build`: passed; final screenshot run rebuilds the production application.
- `npm run audit:ci`: passed with the unchanged existing exception policy; production audit reports zero vulnerabilities. Full audit reports seven finding entries under the existing allowed development-only advisory. No dependency or audit-policy changes.
- `git diff --check`: passed.
- `npx --no-install tsc -p tests/tsconfig.json`: passed.
- `TASK21_PLAYWRIGHT_MODULE=/opt/codex/runtimes/cua/lib/node_modules/playwright/index.mjs node scripts/task21-ui-verify.mjs`: production Next pages against a synthetic loopback Data API, both routes × four states × two widths. The final synthetic browser matrix records source `8153524e90730bfa74cb658f1bb961e872729cd3`. See the committed [UI evidence](evidence/task21/ui-validation.json) and screenshots. The runner replaces all application credentials/URLs with synthetic values, starts/stops its own local processes and does not invoke manual sync or generation repair.

Browser verification also records the unchanged baseline favicon 404 separately; there are no page exceptions or unexpected application-resource errors. No favicon/shell redesign is included.

The first complete application run found old wording/tree-shape expectations and the newly permitted audit-only write before lock refusal, plus an inventory-import placement error. These were corrected; no checks were removed or relaxed. New tests assert actual shared status across Overview, Settings and the authorized action, including unavailable status and no leaked invocation/lease IDs. Status-only reads leave canonical totals unchanged.

## Database verification boundary

Command: `PATH="$PWD/work/bin:$PATH" DISPOSABLE_DB_ACK=yes npm run test:stabilization-db`. The workspace's npm Supabase package postinstall did not install a runnable CLI, so `work/bin/npx` delegates only the repository-pinned `supabase@2.48.3` command to the official 2.48.3 release binary downloaded under `work/`; other npx calls use the installed Node toolchain. The migration was generated using this supported CLI, not a hand-assigned filename.

The first local attempt was interrupted during the large disposable Postgres image pull before any stack or assertion ran; it is **not passed verification**. The second attempt was blocked while extracting the disposable Postgres image: `failed to register layer ... no space left on device`. It was stopped before any stack or database assertion ran. Local full Supabase verification is therefore **blocked by Docker storage capacity**, not passed. A reachable registry alone does not certify a full Supabase run. No supplemental PostgreSQL-only result is substituted for the fresh/upgrade SQL + Data API gate.

The unchanged CI workflow runs the extended disposable fresh/upgrade harness against the exact PR head. Its final result and sanitized artifact must be inspected before claiming full verification. The added inventory covers both RLS tables and all four invoker/empty-search-path functions. Integration checks require real service-role allowance and anonymous/authenticated permission denial for every callable RPC/table (trigger-helper denial is checked directly through SQL and the catalog), atomic rollback/replay, stale-worker rejection and concurrent completion; upgrade validation explicitly preserves every already-installed Task 20/source/progress table before and after Task 21, leaving both new evidence tables empty. Existing Task 20 integration now also observes coherent active-generation status across a racing cutover and subsequent rollback.

## Production remains unverified

No production SQL/migration, real Matter synchronization, historical recomputation/cutover/rollback, deployment/promotion, secret rotation or merge. Production source coverage, real scheduled delivery, deployment/migration/configuration state, grants/RLS/advisors, performance and release certification remain external gates. See [the status contract and rollout notes](task-21-status.md).
