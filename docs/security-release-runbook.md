# W1–W3 security release runbook

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests targeting `main` and pushes to
`main`. It installs the lockfile with `npm ci`, generates Next.js route types,
and runs typechecking, linting, unit tests, the production build, and dependency
audits on Node.js 22 LTS. The regular verification job does not require
application secrets or contact Matter or Supabase. Equivalent local commands are:

```sh
npm ci
npx --no-install next typegen
npm run typecheck
npm run lint
npm run test
npm run build
npm run audit:ci
```

Pull requests also run **Fresh and upgrade database verification** on a
GitHub-hosted Ubuntu runner with Docker. This job checks out the exact PR head,
uses Node.js 22 and `npm ci`, and executes `DISPOSABLE_DB_ACK=yes npm run test`.
That explicit acknowledgement adds the existing pinned Supabase CLI 2.48.3
fresh/upgrade runner after the unit suite; ordinary `npm run test` stays
database-free. Only runner-owned temporary local stacks and synthetic fixtures
are permitted, with no application secrets or external database connections.
Failed or blocked verification fails the job. JSON evidence, including the
known-field CI outcome, is retained from `artifacts/stabilization-db/` even on
failure. The existing `test:stabilization-db` entry point remains available.

The audit command retains the unmodified full and production JSON reports in
`audit-results/`. Production must have zero findings. The full graph permits
only `GHSA-vfj7-8cjw-p6xm` and package entries whose `via` chains resolve
exclusively to that advisory; it does not waive a package or severity class.
Reports must contain non-negative, internally consistent severity counters and
complete vulnerability/advisory/remediation records. Explicit npm errors,
malformed or incomplete responses, audit transport failures, unresolved or
cyclic `via` chains, any other advisory, and any production occurrence fail the
gate. Low and moderate counts are always printed explicitly.

The exception is limited to development/build glob processing over static,
repository-controlled patterns. Re-review it whenever the lockfile or
Tailwind/ESLint dependency graph changes, and remove it as soon as `braces` or
an upstream dependency publishes a supported fix. A published fix must not be
left silently excepted. The gate therefore fails with an actionable message
when npm reports a non-major compatible remediation. A proposal explicitly
marked by npm as a semver-major migration (including the currently suggested
`eslint-config-next` downgrade) does not by itself end the exception; malformed
remediation metadata fails closed and requires review.

## W2 dependency baseline update (completed 2026-10-03)

**Status: complete for applicable critical/high findings.** The registry and
audit service were reachable. Next.js and `eslint-config-next` remain on the
reviewed 15.5.27 line. npm regenerated the lock after applying the smallest
compatible fixes available in the existing major lines. The manifest enforces
Node.js 20.9.0 or newer because patched sharp 0.35.x requires that runtime.

The PostCSS override is intentionally scoped to the package name and references
the root `postcss` spec (`$postcss`). This replaces Next.js's exact vulnerable
8.4.31 transitive pin with the same PostCSS 8 API used by the root build tool.
The sharp override selects 0.35.4, which Next.js 15.5.27 explicitly permits via
`^0.34.3 || ^0.35.4`. Both overrides were resolved by npm; no lockfile integrity
value was written manually.

### Advisory disposition

| Identifier(s) | Dependency path and versions | Affected / patched | Application use and exploit prerequisite | Resolution |
| --- | --- | --- | --- | --- |
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) | `next > sharp`, 0.34.5 → 0.35.4 | `<0.35.0` / `0.35.0`; `<0.35.4` / `0.35.4` | Next.js image optimization can decode external image bytes. Exploitation requires a crafted image reaching a vulnerable libvips/libheif decoder; therefore this is runtime-applicable even though sharp is optional. | Fixed at 0.35.4. A native smoke test decodes and resizes a generated PNG. Node `>=20.9.0` is now enforced. |
| [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | `next > postcss` 8.4.31 and root/Tailwind PostCSS 8.5.14 → one overridden 8.5.23 | `<8.5.10` / `8.5.10`; `<=8.5.11` / `8.5.12`; `<=8.5.22` / `8.5.23`; `<=8.5.17` / `8.5.18` | CSS serialization XSS requires unsafe output insertion; file disclosure issues require attacker-controlled CSS/source-map comments during compilation. Application styles are repository-controlled, but the package is used by the production build and was treated as applicable. | Fixed at 8.5.23 across every locked path. The production build and a direct Tailwind compilation validate the override. |
| [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | `postcss > nanoid`, 3.3.12 → 3.3.19 | `<3.3.16` / `3.3.16`; `<3.3.18` / `3.3.18` | A denial of service requires passing attacker-controlled negative or zero sizes to Nano ID's non-secure/custom generator. The application does not call Nano ID; PostCSS uses it internally while generating source-map identifiers. | Fixed at 3.3.19 within major 3. |
| [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68), [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m), [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj), [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) | `@eslint/eslintrc > js-yaml`, 4.1.1 → 4.3.2 | `<=4.1.1` / `4.2.0`; `<4.3.0` / `4.3.0`; `<4.3.1` / `4.3.1`; `<4.3.2` / `4.3.2` | CPU denial of service requires parsing malicious YAML aliases, merge chains, or `!!omap` input. ESLint is build-only and this repository's flat config does not parse user-provided YAML. | Fixed at 4.3.2 within major 4. |
| [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp), [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895), [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | `@eslint/eslintrc > minimatch > brace-expansion` 1.1.14 → 1.1.21; `@typescript-eslint/typescript-estree > minimatch > brace-expansion` 5.0.6 → 5.0.12 | npm's audited ranges end at 1.1.20 and 5.0.11; fixed by 1.1.21 and 5.0.12 | Resource exhaustion requires malicious brace patterns. These paths process repository-controlled lint file patterns, not request data. | Fixed on both locked major lines. |
| [GHSA-w9m9-85wc-3x92](https://github.com/advisories/GHSA-w9m9-85wc-3x92) | `tailwindcss > postcss-selector-parser`, 6.1.2 → 6.1.4 | `>=6.1.0 <6.1.3` / `6.1.3` | Stack exhaustion requires a malicious deeply nested CSS selector during compilation. Styles are repository-controlled, but CSS compilation is a required build path. | Fixed at 6.1.4 within major 6. |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `tailwindcss > chokidar/fast-glob/micromatch > braces`, 3.0.3 | `<=3.0.3`; no patched release exists | Stack exhaustion requires an attacker to supply a deeply nested brace glob. The only Tailwind content globs are three static literals in `tailwind.config.ts`; ESLint likewise uses static repository configuration. No request, Matter, database, or other user-controlled value reaches these build-only glob APIs. | Residual audit finding accepted as **not application-exploitable** pending an upstream patched `braces` release. It is absent from `npm audit --omit=dev`; replacing it currently requires an unsupported/unavailable package change, so no forced downgrade or major upgrade was applied. |

### Final verification

- `npm ci`: exit 0; 505 packages installed from the lock.
- `npm audit --json`: exit 1; 8 high entries, all propagation from the single
  unpatched build-only `braces` advisory described above.
- `npm audit --omit=dev --json`: exit 0; 0 vulnerabilities.
- `npm run typecheck`, `npm run lint`, and `npm run build`: exit 0.
- `npm run test`: exit 0; 105 total, 98 passed, 0 failed, and 7 pre-existing
  stabilization TODO tests.
- Direct sharp PNG decode/resize and direct Tailwind CSS compilation: exit 0.
- `git diff --check`: exit 0.

There are no unresolved applicable critical/high findings. The only remaining
high advisory has no patched release and is isolated to development/build glob
processing with static, repository-controlled patterns. Re-run both audits when
`braces` publishes a fix or Tailwind's dependency graph changes.

## Task 13 sharp advisory follow-up

Task 13's 2026-10-07 dependency follow-up updates the current sharp override to
0.35.5 to fix [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
The W2 version/results above are historical. Next.js remains 15.5.27; the existing
Tailwind selector override and audit policy are unchanged, with no new advisory
exceptions. npm regenerated the sharp/platform/libvips lock entries, a native
PNG decode/resize smoke check passed, and production audit reports zero findings.
See [task-13-validation.md](task-13-validation.md) for actual tested SHAs, full
CI/disposable results, gateway investigation and cleanup evidence.

## Required configuration

- Existing: `APP_ACCESS_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MATTER_API_TOKEN`, `CRON_SECRET`.
- New: `APP_CREDENTIAL_VERSION=1`. Increment it to revoke every existing app session after an access-password rotation. This does not rotate the Matter token.
- `x-forwarded-for`'s first address is the limiter key because Vercel supplies that boundary. On another proxy, normalize/overwrite it at the trusted edge. Five failed attempts per key in 15 minutes are permitted; state is shared in Supabase. Unknown/missing addresses share the `unknown` bucket.

## Pre-deploy on an isolated Supabase project

1. Prepare both migration paths. For a fresh environment, apply the full migration chain in timestamp order. For an upgrade environment, restore/synthesize the previous schema and apply every outstanding migration in timestamp order. In both cases the required release sequence is `20260929000000_harden_rls_and_auth.sql`, then `20260929010000_atomic_login_limiter.sql`, then application deployment.
2. From an unlinked checkout with Docker available, set only `DISPOSABLE_DB_ACK=yes` and run `npm run test:stabilization-db`. This is the complete Task 05 entry point; `test:security-db` remains an internal Data API suite invoked by the runner, not a substitute for fresh/upgrade verification. The runner pins Supabase CLI 2.48.3 and creates two uniquely named projects under an OS temporary directory, with separate non-conflicting local ports. It sanitizes child environments, refuses non-temporary cleanup targets, never links a project, and stops only the two project IDs it created. Do not supply the application's normal Supabase or Matter variables and never point this command at a linked, shared, staging, or production project.

   The fresh path applies the complete repository migration chain. The upgrade
   path first applies migrations through `20260519090000`, inserts synthetic
   legacy items, sessions, tags, relationships, annotations, daily statistics,
   sync-run data, and the `sync_state` singleton, then applies every outstanding
   migration in place. A deterministically ordered before/after JSON snapshot
   captures every stored column in all eight legacy tables and must preserve
   identifiers, relationships, values, row counts, total reading duration, and
   singleton state exactly. Only after that comparison, the runner verifies the
   singleton's run-specific ownership marker, removes it by key and marker, and
   confirms absence so the collision-refusing Data API suite can safely run.
   Unexpected ownership, failed removal, or failed absence verification stops
   the path without deleting an unrelated singleton. Both paths run the same
   catalog and real Data API checks.

   Catalog verification invokes container `psql` with startup files disabled,
   `ON_ERROR_STOP=1`, quiet tuples-only output, and exact comparison of the
   database's complete ordered migration history with the repository. It checks
   RLS, exact function signatures and inherited execution, browser-role CRUD
   absence (including effective SELECT, INSERT, and UPDATE column grants), and
   service-role SELECT, INSERT, UPDATE, and DELETE individually.
   Sanitized evidence under `artifacts/stabilization-db/<tested-sha>/` records
   tooling, migration histories, verification results, and cleanup status. This
   directory is ignored because evidence is execution-specific. If Docker is
   unavailable, the runner writes `blocked.json`, exits nonzero, and does not
   claim that mocked tests establish database behavior.

   The suite creates one uniquely named, constraint-valid fixture for every
   inventoried table in migration/foreign-key order. It uses the real composite
   key for `item_tags`, `date` for `daily_stats`, `token_hash` for
   `app_sessions`, `client_key_hash` for the keyless `app_login_attempts`, and
   the only valid `sync_state` key, `matter`. Service-role controls must insert
   and read every row, update an existing row and confirm the changed value,
   then delete it and confirm absence. Anonymous and signed-in clients issue
   equivalent valid operations against the seeded rows; their expected outcome
   is PostgreSQL `insufficient_privilege` (`42501`) whose message identifies
   `permission denied for table <expected table>`, not merely the shared
   SQLSTATE. A successful empty RLS result, an RLS `WITH CHECK` violation, a
   denial naming another table/schema, or an arbitrary error is not evidence
   that the intended object grant was revoked. Schema-cache/missing-object,
   payload, constraint, authentication, transport, and server errors fail the
   run. Service-role readback confirms rejected writes changed nothing.

   The limiter check gives both browser roles valid arguments and requires the
   same `42501` response naming `permission denied for function
   record_app_login_attempt`. Its service-role control must return `true` and
   persist one matching attempt. Two independent 20-call groups must both settle
   before results are reported or cleanup begins. Each group requires no rejected
   request or RPC error, only boolean responses, exactly 5 `true` results, exactly
   15 `false` results, and exactly 5 stored attempts. A `finally` cleanup removes RPC attempts,
   fixtures in reverse foreign-key order, and the disposable Auth user. Cleanup
   continues after individual failures and any cleanup failure fails the run;
   every write is tracked before its request is awaited, so cleanup also
   reconciles a row that committed before its response was lost. Selectors are
   run-specific; the fixed-key `sync_state` fixture additionally stores a
   run-specific ownership marker and is never deleted unless that marker is
   read back. Uncertain ownership is reported as a cleanup failure rather than
   risking deletion of unrelated data.

   This distinction follows Supabase's documented Data API model: grants are
   evaluated before RLS, a missing grant produces a permission error, and a
   policy matching no rows can instead produce an empty result. PostgreSQL
   assigns `42501` to the broader `insufficient_privilege` condition, while
   PostgREST's documented table-grant response includes `permission denied for
   table <name>`; the suite therefore verifies both the code and expected
   object-specific message. See
   [Securing your API](https://supabase.com/docs/guides/api/securing-your-api),
   [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security),
   [PostgreSQL error codes](https://www.postgresql.org/docs/current/errcodes-appendix.html),
   and the [PostgREST authorization tutorial](https://docs.postgrest.org/en/v11/tutorials/tut0.html).
3. With the service-role key, create/read/revoke a disposable app session and exercise ordinary application queries. Delete the disposable project/data afterward.
4. Run `supabase/audit/stabilization-read-only.sql`; retain sanitized table, policy, function-grant and view results. Run all application checks and inspect client chunks for secret values/names. Until both fresh and upgrade runs succeed, W1 is not release-ready.

Do not replace the full entry point with a catalog-only check or a manually
provisioned database. Both independently configured local stacks and the real
Data API checks are required for valid Task 05 evidence.

### Merge prerequisites

W1 may merge only after sanitized evidence exists for both migration paths and
the real Data API suite. W2 may merge only after official advisory review,
successful `npm audit`, and the smallest supported patched lockfile update (or
documented proof that the locked versions already satisfy every applicable
advisory). W3 additionally requires the real 20-request concurrency assertion.
Passing unit tests alone does not satisfy any of these external gates.

## Controlled deployment (requires separate approval)

With separate production authorization, backup/export affected schema/data and apply all outstanding migrations in timestamp order. Specifically, apply `20260929000000_harden_rls_and_auth.sql`, then `20260929010000_atomic_login_limiter.sql`; only after both succeed, add `APP_CREDENTIAL_VERSION` and deploy the reviewed application commit. Log migration and commit identifiers; sign in, access a dynamic/dotted article path, log out, confirm replay rejection, and test cron with missing/wrong/correct Bearer secret. Run the read-only audit and Supabase Security Advisor. Do not mutate personal production data merely to test RLS.

Existing deterministic cookies become invalid, so one fresh login is expected. Raw reading/library data is unchanged. The new tables contain only hashes and timestamps.

## Rollback

Prefer rolling code forward. Code rollback requires restoring compatibility with the old cookie and should only happen after security review; do not disable RLS as a routine rollback. The additive auth tables may remain unused. Dropping them loses revocation/limiter history and is a separately approved destructive action. Restore from backup only if migration integrity fails.

## Task 12 / E2 / W4 / R4 verification and release gate

Ownership and the complete production mutation inventory are in
[architecture.md](architecture.md#account-lease-and-fencing-task-12--e2--w4--r4).
Rollout/rollback must follow [deployment.md](deployment.md#task-12-rollout-and-rollback-compatibility),
including blocking and draining every old unfenced sync writer. Applying an
additive lease migration alone does not protect against old table writes.

The full `DISPOSABLE_DB_ACK=yes npm run test:stabilization-db` entry point now
runs `tests/integration/matter-sync-lease.mjs` on both disposable fresh and upgrade
stacks, after the existing security suite. It compiles and loads the production
sync/import/enrichment/recalculation paths. Only Matter HTTP is synthetic; SQL,
Data API grants, auth-role clients, RPC writes and concurrency are real. It uses
only local orchestrator-generated URLs/keys and a validated, runner-owned Docker
project ID, never application credentials or an arbitrary SQL host. Generation
is never deleted/reset during fixtures or cleanup. All domain fixture collisions
are rejected, stream seeds are recognized before modification, cleanup releases
only owned generations, restores seeds under a new valid lease, removes only
claimed synthetic rows and deletes its disposable Auth user. The entire stacks
are ultimately stopped by the existing owner-scoped orchestrator.

Required real assertions include:

- 24 parallel Data API acquisitions and 12 parallel SQL transactions each admit
  exactly one owner; 24 concurrent production manual/scheduled/library contenders
  behind a paused request make no Matter calls or protected writes.
- Valid renewal preserves generation; wrong owner/generation, expired renewal,
  invalid/NULL TTL and stale release fail. Release/expiry recovery increments it.
- After an application-level lease check, a deterministic SQL expiry fixture lets
  B acquire a newer generation. Every production mutation RPC rejects A,
  including item-tag deletion, rollups, both streams, retry state and successful
  completion, with unchanged database snapshots.
- A real protected RPC transaction retains the lease row lock through commit;
  the SQL barrier confirms takeover waits using `pg_stat_activity`, then the old
  generation cannot write. No Matter request occurs while that fixture holds a
  SQL transaction.
- Delayed Matter success and 429 responses after takeover cannot import results,
  advance state, overwrite cooldown or complete/release the successor's lease.
  Cancellation runs compare-and-release; crashed fixtures recover via expiry.
- Both browser roles receive exact `42501` object-specific grant denials for the
  lease table and all 14 function signatures (including helpers). Real service
  controls execute each operation. Invalid payload, missing-function/cache,
  auth and transport errors fail verification; they are never counted as grant
  denial. Service-role DELETE on the durable lease is deliberately denied.
- Upgrade first applies Task 11, stores synthetic active contracts with nonzero
  generations, cursors, watermarks and cooldowns, then applies Task 12 and checks
  every stream column remains identical. Existing legacy-domain preservation and
  the Task 11 resume/window/cooldown regressions remain required.

The catalog inventories RLS, effective browser table/column privileges, PUBLIC
ACLs, service SELECT/UPDATE with no lease INSERT/DELETE/TRUNCATE, exact RPC/helper
signatures, invoker execution and empty search paths. The read-only audit also
includes the stream and lease inventories. The table's direct UPDATE permission
is trusted administrative/service access; production sync writes use the fixed
RPCs. No SECURITY DEFINER privilege escalation or arbitrary mutation API exists.

Run `npm ci`, route type generation, typecheck, lint, tests, build, audit:ci and
`git diff --check`. Run both real disposable paths before declaring R4 database
verification passed or enabling sync in a release. If Docker/CLI/subprocess
prerequisites are unavailable, record **BLOCKED** with the exact failing layer;
unit tests and SQL inspection do not substitute for execution evidence. This
Task 12 implementation adds no full-page commit guarantee (Task 13), continuation,
backfill/shared quota (Tasks 14–15), production repair, deployment or merge.

Official mechanisms reviewed for this change: [Supabase database functions](https://supabase.com/docs/guides/database/functions),
[PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS),
[database wall-clock time](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT),
[function privileges](https://www.postgresql.org/docs/current/sql-createfunction.html),
and [PostgREST request transactions](https://docs.postgrest.org/en/stable/references/transactions.html).
The Supabase changelog index was unavailable; the official changelog page and the
current functions/grants documentation were inspected instead.

## Task 13 page/recovery verification

The gate additionally runs `tests/integration/matter-page-commit.mjs` after the
Task 12 concurrency/row-lock suite on both disposable stacks. Only Matter HTTP
and lost/interrupted response transport are synthetic; the application imports,
Data API, SQL transactions, rollup calculations and role denials are real.
Postgres triggers that raise after row writes or at checkpoint/daily persistence
exist only in runner-owned disposable databases and are dropped in finally.
No production fault-injection route or delay-based concurrency assertion exists.

`matter_page_receipts` and `matter_dirty_rollups`, plus all four new exact RPC/helper
signatures, are catalog-inventoried for RLS, effective PUBLIC/browser denial,
service grants, invoker security and empty search_path. Browser clients perform
real object-specific 42501 reads/writes/execute checks; service controls verify
CRUD and intended RPC operation. The upgrade path first verifies Task 12 preserves
Task 11 state, then seeds an active Task 12 owner/generation/expiry and compares
its full lease/stream snapshot across Task 13 migration. It releases only that
synthetic owner and retains its generation for subsequent concurrency tests.

Retain the tested SHA, complete migration histories, sanitized page/lease assertions
and owned-stack cleanup in `artifacts/stabilization-db/<tested-sha>/results.json`.
A failed or blocked path cannot establish release readiness. Consult
[task-13-validation.md](task-13-validation.md) for actual checks and blockers, and
[deployment.md](deployment.md#task-13-release-order-and-rollback) for stopping old
writers/previews, migration-before-code order and checkpoint/marker-preserving
rollback. No merge, deployment, production migration or personal-data mutation is
authorized by these tests.

## Task 14 continuation/history verification

`matter_sync_continuation` is service-only, RLS enabled, with SELECT/UPDATE and no
INSERT/DELETE/TRUNCATE for the service role. Its exact signatures (four lease-
fenced RPCs and one completion trigger function) are inventoried in
`scripts/matter-continuation-inventory.mjs`. All use SECURITY INVOKER, empty
search_path and qualified relations. Direct administrative UPDATE is a trusted
service boundary; application mutations use transactional account fencing. The
completion trigger belongs to the enclosing already-fenced page transaction.

The disposable fresh AND upgrade gate also executes the production multi-page
runtime with synthetic Matter only: 5,000 minimal documented sessions across years
and tied timestamps, an independent SQL raw-data reference, recreated worker
processes, daily authenticated cron, pending library work, request/time interruption
inside enrichment, expensive-page admission, terminal receipt replay, cooldowns
and stale intent/start/scheduling/cooldown mutations. Real signed-in `authenticated`
and `anon` clients must get exact object-specific 42501 denials for new table CRUD
and every exposed RPC signature. The trigger-returning function is absent from
PostgREST RPC discovery; its exact denial uses real SQL SET ROLE, with completion
verified through the production page transaction. Invalid payload/cache/gateway errors never
count as denials. Existing auth/cron, Task 12 barriers and Task 13 crash/rollup
checks remain gates. The upgrade path additionally snapshots receipts and dirty
revisions across Task 14, preserving prior stream/cooldown/lease/legacy state.
The owned disposable Kong transport uses verified upstream keepalive pool size
zero to avoid observed connection resets under the large fixture. Real gateway/
Data API authentication and all SQL/RLS assertions remain required; failed HTTP
responses still fail the gate. This setting is not applied to production.

Retain exact tested SHA, results, complete migration histories and owned fixture/
Auth/stack cleanup. Unavailable or failed execution is BLOCKED/FAILED, never passed.
See [task-14-validation.md](task-14-validation.md). No production migration, sync,
deployment, merge or personal-data operation is authorized by the test runner.
