# Task 20 validation and remaining production gates

Base: `739cade8e0366963fe2f7332b5b78516e01f9125`, latest fetched origin/main on 2026-10-14; no subsequent changes existed at inspection. Final implementation: `232bf91b059ece57cf973a2c31a737fa7fd94559`. The final evidence/documentation-only SHA is recorded in the draft PR. No runtime files or migration change after this implementation head.

[Operator guide](task-20-operator-guide.md) contains the complete reader/writer inventory, metric contract, bounded lifecycle, operator commands, compatibility/rollback limits, migration/application ordering and future authorization gates. [Synthetic evidence](evidence/task20-synthetic.json) is copied from the retained full Supabase artifact, not from a mock or supplemental PostgreSQL run.

## Reviewed implementation gates

[Full CI run 38596988638](https://github.com/dfalidas/matter-stats/actions/runs/38596988638) completed **successfully** at implementation head `232bf91b059ece57cf973a2c31a737fa7fd94559`. Both jobs and every required step passed. The final full [Supabase artifact](https://github.com/dfalidas/matter-stats/actions/runs/38596988638/artifacts/11910743702), `results.json`, cleanup and CI outcome were downloaded through the GitHub connector and independently inspected. Its database SHA equals the implementation head; the application checkout was synthetic merge `30abf33defbc24cea9dda445a2af6e39e6c299ba`. The PR records the later documentation-only final head and its CI results.

| Gate | Outcome |
| --- | --- |
| Locked `npm ci`, Next route types, typecheck | PASSED locally and in CI |
| Lint | PASSED; zero errors, four existing warnings |
| Application tests | **346 passed, 0 failed/cancelled/skipped/TODO** |
| Production build | PASSED in CI and locally at the implementation head |
| Unchanged `audit:ci` | PASSED in CI; production zero vulnerabilities; seven existing development finding entries under the unchanged reviewed exception |
| `git diff --check` | PASSED |
| FULL `DISPOSABLE_DB_ACK=yes npm run test:stabilization-db` | PASSED on **fresh AND upgrade** in CI, exact implementation head; all 19 migrations, catalog/RLS/exact ACL/signature inventories, browser auth/security, leases, real pages/rollup recovery, continuation/quota, Task 19 preview and Task 20 |
| Task 19→20 upgrade | PASSED: all inventoried source/provenance/progress fields fingerprint-identical, known canonical provenance retained, migration installs inactive |
| Owned cleanup | PASSED on both stacks; cleanup failures remain fatal to the gate |
| Production SQL/read/repair/cutover/rollback, Matter sync, deployment/promotion, merge | NOT EXECUTED |

The database job checks out the exact PR head. The application job uses GitHub's synthetic merge checkout; its exact checkout SHA is recorded below. Local application checks run at the clean implementation head. Pending checks are never counted as passed.

## Real SQL/Data API Task 20 evidence

| Path | Task 20 groups (pass/fail/skip/TODO) | Sessions independently checked | After subsequent ingestion | Browser denials | Cleanup |
| --- | --- | --- | --- | --- | --- |
| Fresh | **10 / 0 / 0 / 0** | **10,614**, 9 reading dates | **10,618**, 10 dates | **56** table + **16** function | PASSED |
| Upgrade | **10 / 0 / 0 / 0** | **10,615**, 10 reading dates | **10,619**, 11 dates | **56** table + **16** function | PASSED |

Five unresolved synthetic capture rows are required to block readiness: blank ID, null duration/timestamp, nonfinite timestamp, an unsupported local occurrence date, and an unsupported daily date. The passing suite asserts their retained reasons and incomplete preview; the committed artifact records the successful replacement run's reconciliation after owned fixture removal. Expected rejection/fault cases count as passed acceptance checks, not hidden test failures.

Each path independently compares all raw/source/unrelated/progress values around repair transitions, and verifies staged estimates/dates/aggregates from separate JavaScript raw-session calculations. The suite exercises:

- More than 10,000 sessions, 10,003 timestamp ties, actual HTTP keyset reads capped at 127, all **601 integer duration cases 0–600**, the five exact near-half boundaries (2→8, 6→23, 130→487, 246→922, 262→982), **675** for three 60-second sessions and **12** for three 1-second sessions.
- Athens midnight, both DST changes, Monday/month/year reassignment, zero and unlinked sessions, missing daily baselines and stale/obsolete dates. Empty reading fields preserve item/highlight/source metadata. Unknown old methods/calendars stay unknown; equal estimates do not identify provenance.
- Failure before commit with exact checkpoint/output rollback, successful commit followed by SIGKILL/response loss, fresh-process resume, competing workers, stale fences, expiry takeover and repeated bounded execution. Actual rejection SQL codes are asserted; a gateway timeout cannot pass as rejection.
- Interrupted capture/source inconsistency: even restoring a lost barrier after source edits cannot certify old chunks; progress/readiness/activation are rejected, explicit cancel retains partial evidence, and a new capture uses a new source generation.
- Deliberate shadow estimate corruption: independent raw-based reconciliation detects the mismatch and blocks readiness/cutover. No raw correction is performed.
- Inserts behind the cursor, processed-session updates/date reassignment, a writer actually observed waiting on the cutover mutex, stale readiness refusal and complete catch-up. Real production `getArticleDetail`, daily readers, fenced page writer and dirty-rollup acknowledgement/recovery are exercised.
- One captured generation per affected read/request during pointer switches; rollback before and after subsequent normal ingestion, new raw IDs never hidden, conflicting/stale transitions refused, repeated rollback idempotent, full unknown-calendar baseline refresh and unchanged-input no-op with zero preview deltas.
- Explicit invalid ID/duration/timestamp/calendar rows, invalid reasons retained, blocked cutover, anonymous AND authenticated browser-role denial, server fencing and ownership-checked cleanup.

Raw comparisons include count/IDs, duration, source UTC timestamps, link/device fields, created/updated fields and persisted raw-derived/provenance columns. Those raw columns remain untouched by repair; intentionally changed shadow fields are compared separately. Unrelated library fields and daily metadata are preserved; repair does not reset receipts, dirty revisions, cursors, cooldowns, stream/lease generations or progress. Ordinary ingestion changes its own fields legitimately; each later cutover/rollback comparison uses the post-ingestion raw baseline.

## Local environment limits and retained historical failures

The full gate was also invoked locally at the reviewed implementation head. The 32 GiB, vfs-backed executor cannot extract the pinned Supabase stack image: Docker repeatedly reports **`failed to register layer ... no space left on device`** before creating the fresh stack. Upgrade/Data API/repair checks do not run locally in that failed attempt. Its sanitized failure/cleanup are retained under `artifacts/stabilization-db/<SHA>/`; this is an environment blocker, not a passing database test. The reviewed **full** CI run closes the actual Supabase/Data API gate; supplemental PostgreSQL does not substitute for it.

The pinned CLI's npm postinstall failed in this managed executor. The official same **2.48.3** binary was downloaded with verified HTTPS and used for migration creation and the unchanged local runner through an ignored local npx wrapper accepting only that exact CLI package/version. No dependency, lockfile, CLI pin or enforcement changed. CI uses the normal pinned CLI installer.

Supplemental `DISPOSABLE_DB_ACK=yes node scripts/task20-postgres-validation.mjs` uses a digest-pinned PostgreSQL 17, owner-labelled disposable container, no published ports and owned cleanup. It passes the SQL engine/CLI/fault/reconciliation tests and explicitly reports `realSqlAndDataApi=false`. Development SQL results with a dirty tree are not proof that the then-current commit contains that work. Only the full CI artifact is used for committed acceptance evidence.

Historical results remain distinct from final verification:

| SHA/run | Outcome and diagnosis |
| --- | --- |
| `d7def63b3033f3c445a85b97679ed35f2319c8f5`, [CI 38581777904](https://github.com/dfalidas/matter-stats/actions/runs/38581777904) | Application job PASSED, 346 tests/audit; fresh repair capture failed with gateway 504, upgrade not run. Initial local full setup was interrupted during review before SQL acceptance. |
| `79448f73f477465492c7128e68f1f510948acd53`, [CI 38584866553](https://github.com/dfalidas/matter-stats/actions/runs/38584866553) | CANCELLED when the next implementation was pushed; no accepted full-gate result. |
| `41d1ab3bbb4a181d3836f187a2fe9929475f6b29`, [CI 38585247031](https://github.com/dfalidas/matter-stats/actions/runs/38585247031) | Application job PASSED; full database job CANCELLED by the next implementation. Local audit returned the varying compatible-remediation metadata failure; local full setup interrupted for the source-consistency correction. |
| `629d482328fec51a1df4fea9a5a10b700c9b3cb9`, [CI 38586867770](https://github.com/dfalidas/matter-stats/actions/runs/38586867770) | Application job PASSED. Fresh repair failed: stale-worker rejection produced 504 and left adapter transactions retrying/contending; cancel then timed out. Upgrade not run. Local full gate FAILED image extraction with ENOSPC; owned cleanup PASSED. One concurrent local build also failed ENOSPC; later builds passed. |
| `fada031222a4b22a28702c2e5f288f582f7f7471`, [CI 38590454504](https://github.com/dfalidas/matter-stats/actions/runs/38590454504) | PASSED both jobs and the full fresh/upgrade gate after the non-retryable fencing fix. Artifact downloaded through the GitHub connector and inspected: 10 Task 20 groups/path, zero failures/skips/TODO, 72 browser denials/path and owned cleanup. Final unsupported-calendar/invalid-reason additions were verified at the later implementation head. |

The deterministic stale/expected-generation checks originally used SQLSTATE **40001**. PostgreSQL defines that as serialization failure; the pinned Data API's Hasql transaction wrapper retries that class. Direct psql tests did not expose the adapter behavior. The fix uses **55000** prerequisite-state failures, consistent with existing lease paths, and requires exact rejection codes in SQL AND Data API tests. No timeout/rejection expectation was weakened. Gateway diagnostics and the later successful full run support this diagnosis.

Local audit responses varied: some marked a compatible remediation for `tailwindcss-animate`, causing the **unchanged** enforcement to fail; other responses and every reviewed application CI job passed with production zero vulnerabilities and the existing development exception. These failures are retained without inferring an unrelated dependency upgrade from anomalous remediation metadata. No dependency or audit policy changed.

Direct artifact download via gh in this executor returned HTTP 403 on the temporary Azure redirect. The supported GitHub connector successfully returned downloadable ZIP bytes; the retained JSON results/cleanup/CI outcome were then independently inspected. This access issue does not invalidate the passed gate and is not left as an unverified artifact claim.

## Inventory, compatibility and future gates

Only new migration `20261014140402_bounded_derived_generations.sql` is added, after unchanged Task 19 `20261014084407_estimation_provenance.sql` and all earlier migrations. Every pre-existing migration blob is unchanged. New inventory: **7 RLS tables, 14 exact-signature invoker functions with empty safe search paths, 4 coordination triggers**, no views or hosted cron/queue/service. Source capture is SELECT/INSERT only; the singleton SELECT/UPDATE only; service-role TRUNCATE is not granted. History is retained, without automatic destructive cleanup.

Capture/verification intentionally pause session/daily mutations through a persistent flag, without an open operator transaction. Use bounded explicit commands and resume/cancel a frozen run. Only the active/immediate predecessor is maintained and eligible for rollback. Unknown calendar semantics require conservative refresh of all baseline reading dates after source mutation; untouched session values/provenance and immutable originals remain preserved. Raw derived-column exports and older reader deployments cannot observe the new versioned read contract and must be excluded. Canonical raw-session metric readers preserve their behavior.

Before any separately authorized production run: validated backup/export including raw/provenance/generation/ingestion state, tested isolated restore and recorded evidence, invalid-row policy review, drained older readers/writers/previews/cron execution, migration then compatible application rollout, server-role/security checks, explicit expected-generation/epoch approval and reconciled cutover/rollback plan. This task does not enable production-target execution. Task 21 owns broader status UI; Tasks 23–24 own final staging/release.

Git integration automatically created Vercel branch previews on pushes, as shown in PR checks. No manual deployment or production promotion was invoked, and repair remains inactive until prepare is explicitly called. PR #83 remains **draft, open and unmerged**.
