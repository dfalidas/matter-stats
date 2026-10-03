# W1–W3 security release runbook

## W2 dependency baseline update (2026-10-02)

### Follow-up completion for PR #55 (2026-10-03)

**Status: the requested Next.js patch is installed.** Registry access and the
npm audit endpoint both responded without HTTP 403. The manifest now requests
Next.js and `eslint-config-next` 15.5.27, and npm regenerated the lockfile with
15.5.27 for Next.js, its platform packages, and the matching ESLint plugin.

`npm ci`, typecheck, lint, tests, and the production build completed
successfully. `npm audit` also reached the advisory service successfully, but
exited 1 because it reported 15 remaining transitive findings (1 low,
1 moderate, and 13 high). Those findings affect `brace-expansion`, `braces`,
`js-yaml`, `nanoid`, `postcss`, `postcss-selector-parser`, and `sharp`; they are
not an HTTP transport failure and are outside this targeted version alignment.

## Dependency note (2026-09-29)

The lock contains Next.js/eslint-config-next 15.5.18, React/React DOM 19.2.6 and Supabase JS 2.105.4. On 2026-09-29 the web documentation tool returned HTTP 401; direct `curl https://registry.npmjs.org/next`, `npm view next@15 version`, and the npm audit endpoint were rejected by the environment's CONNECT proxy with HTTP 403. Consequently W2 is **open**, not declared vulnerability-free, and no guessed downgrade/upgrade was made. Re-run those commands and review official Next.js/React advisories from an authorized network; select the smallest supported patched 15.x target or request approval for a major.

## Required configuration

- Existing: `APP_ACCESS_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MATTER_API_TOKEN`, `CRON_SECRET`.
- New: `APP_CREDENTIAL_VERSION=1`. Increment it to revoke every existing app session after an access-password rotation. This does not rotate the Matter token.
- `x-forwarded-for`'s first address is the limiter key because Vercel supplies that boundary. On another proxy, normalize/overwrite it at the trusted edge. Five failed attempts per key in 15 minutes are permitted; state is shared in Supabase. Unknown/missing addresses share the `unknown` bucket.

## Pre-deploy on an isolated Supabase project

1. Prepare both migration paths. For a fresh environment, apply the full migration chain in timestamp order. For an upgrade environment, restore/synthesize the previous schema and apply every outstanding migration in timestamp order. In both cases the required release sequence is `20260929000000_harden_rls_and_auth.sql`, then `20260929010000_atomic_login_limiter.sql`, then application deployment.
2. Confirm both 20260929 migrations are present before running an integration test that calls `public.record_app_login_attempt`. Set only `STABILIZATION_TEST_SUPABASE_URL`, `STABILIZATION_TEST_SUPABASE_ANON_KEY`, `STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY`, and `DISPOSABLE_DB_ACK=yes`, then run `npm run test:security-db`. It attempts SELECT/INSERT/UPDATE/DELETE on every inventoried table with real `anon` and `authenticated` clients, verifies service-role reads, rejects the limiter RPC for browser roles, and sends 20 concurrent RPCs that must admit/store exactly five.
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
