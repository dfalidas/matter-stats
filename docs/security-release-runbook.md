# W1–W3 security release runbook

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests targeting `main` and pushes to
`main`. It installs the lockfile with `npm ci`, generates Next.js route types,
and runs typechecking, linting, unit tests, the production build, and dependency
audits on Node.js 22 LTS. The workflow does not require application secrets and
must not contact Matter or Supabase. Equivalent local commands are:

```sh
npm ci
npx --no-install next typegen
npm run typecheck
npm run lint
npm run test
npm run build
npm run audit:ci
```

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

## Required configuration

- Existing: `APP_ACCESS_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MATTER_API_TOKEN`, `CRON_SECRET`.
- New: `APP_CREDENTIAL_VERSION=1`. Increment it to revoke every existing app session after an access-password rotation. This does not rotate the Matter token.
- `x-forwarded-for`'s first address is the limiter key because Vercel supplies that boundary. On another proxy, normalize/overwrite it at the trusted edge. Five failed attempts per key in 15 minutes are permitted; state is shared in Supabase. Unknown/missing addresses share the `unknown` bucket.

## Pre-deploy on an isolated Supabase project

1. Prepare both migration paths. For a fresh environment, apply the full migration chain in timestamp order. For an upgrade environment, restore/synthesize the previous schema and apply every outstanding migration in timestamp order. In both cases the required release sequence is `20260929000000_harden_rls_and_auth.sql`, then `20260929010000_atomic_login_limiter.sql`, then application deployment.
2. Confirm both 20260929 migrations are present before running an integration test that calls `public.record_app_login_attempt`. Set only `STABILIZATION_TEST_SUPABASE_URL`, `STABILIZATION_TEST_SUPABASE_ANON_KEY`, `STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY`, and `DISPOSABLE_DB_ACK=yes`, then run `npm run test:security-db`. Separately set `STABILIZATION_TEST_DATABASE_URL` for the same disposable database and run `npm run verify:security-db`. The catalog runner invokes `psql` with startup files disabled, fail-fast SQL execution, and quiet tuples-only output. It compares the database's complete ordered migration history with every repository migration and verifies RLS, exact function signatures/inherited execution, browser-role CRUD absence, and each service-role SELECT, INSERT, UPDATE, and DELETE privilege individually. Do not supply the application's normal Supabase variables, and never target a linked, shared, staging, or production project. A disposable project must permit Auth admin user creation and must have no existing `sync_state` singleton; the suite refuses to replace it or any colliding fixture.

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

For a local Supabase CLI stack, the fresh check is `supabase db reset --local`. For
the upgrade check, create a second disposable project/branch at migration
`20260519090000`, then run `supabase migration up --local` with the two 20260929
migrations present. Run `npm run test:security-db` against each result. Do not
point these commands at a linked production project.

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
