# Task 21 validation

Base: `18985cc639c03c5de6cd28d366bbaed7d90f142b` (fetched main, no subsequent commits). Final code and PR-head SHAs are recorded in the draft PR, along with final-head CI links/outcomes. No production actions are part of validation.

## Local commands and evidence

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
