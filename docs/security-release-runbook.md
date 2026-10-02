# W1–W3 security release runbook

## W2 dependency baseline update (2026-10-02)

**Status: draft / externally blocked.** The reviewed Git base is
`b6a605d0c50bff847bf5f864ea1c7e71038d05f6`, which is the supplied PR #54
merge commit. A fetch of `origin/main` failed with `CONNECT tunnel failed,
response 403`, so the environment could not prove that this commit was still
the latest remote `main`.

The pre-change lock already resolved Next.js and `eslint-config-next` to
15.5.18 and React/React DOM to 19.2.6, but the manifest still admitted Next.js
15.3.2 and React 19.0.0. The dependency patch raises those four semver floors
to their reviewed locked versions. It intentionally does not introduce
overrides or refresh unrelated packages; the locked dependency graph is
unchanged.

Both baseline audit commands were run after a successful `npm ci`. On this
network, `npm audit --json` and `npm audit --omit=dev --json` each exited 1
because the npm bulk-advisory endpoint returned HTTP 403. Their JSON bodies
contained the transport error rather than vulnerability metadata, so these
are unavailable checks, **not zero-finding audits**. The official-guidance web
lookup also returned HTTP 401, and direct npm registry metadata requests
returned HTTP 403. Accordingly, the versions below are locally installed and
compatible but cannot be represented as a current, externally verified safe
set from this environment. W2 remains blocked until a reviewer reruns the
official-source and live-audit gates from an authorized network.

### Advisory matrix

| Package and locked dependency path | Before → after locked version | Advisory and official source | Affected range / patched version | Applicability | Resolution or verification gap |
| --- | --- | --- | --- | --- | --- |
| `next` (root runtime dependency) | 15.5.18 → 15.5.18; manifest floor 15.3.2 → 15.5.18 | React Server Components advisory family: [React CVE-2025-55182 notice](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components), [React follow-up](https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components), and [Next.js guidance](https://nextjs.org/blog/security-update-2025-12-11) | The installed 15.5.18 is newer than the 15.5.x fixes named by those notices; current affected ranges and any later advisories could not be revalidated because official lookups were blocked. | Runtime and build; this App Router application uses React Server Components. | The manifest can no longer resolve the known-vulnerable 15.3.2 floor. Current completeness remains an external verification gap. |
| `eslint-config-next` (root development dependency) | 15.5.18 → 15.5.18; manifest floor 15.3.2 → 15.5.18 | [Next.js guidance](https://nextjs.org/blog/security-update-2025-12-11) | Kept on exactly the same 15.5.x release line as `next`; registry metadata was unavailable. | Build/development only. | Aligned with Next.js; current registry/advisory verification remains blocked. |
| `react`, `react-dom` (root runtime dependencies and Next.js peers) | 19.2.6 → 19.2.6; manifest floor 19.0.0 → 19.2.6 | [CVE-2025-55182](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components) and the [CVE-2025-55183/CVE-2025-55184/CVE-2025-67779 follow-up](https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components) | The notices patched the 19.2 line progressively through 19.2.3; the installed 19.2.6 is newer. Later guidance could not be checked. | Runtime and build; RSC advisories are applicable to the framework stack even though the vulnerable protocol is mediated by Next.js. | Raised both peer floors together and retained the tested lock. Current completeness remains an external verification gap. |
| `sharp` via `next` | 0.34.5 → 0.34.5 | Live npm advisory record unavailable (HTTP 403). | Could not revalidate an affected range or patched version. | Optional runtime image processing dependency; potentially applicable when Next image optimization loads it. | No override: the parent already locks 0.34.5. A live audit and registry/advisory review are still required. |
| `postcss` via `next`; root `postcss` | 8.4.31 / 8.5.14 → unchanged | Live npm advisory record unavailable (HTTP 403). | Could not revalidate an affected range or patched version. | Next's copy participates in build/runtime CSS handling; the root copy is development/build tooling. | No lock change or override without current evidence; recheck both paths externally. |
| `nanoid` via both `postcss` paths | 3.3.12 → 3.3.12 | Live npm advisory record unavailable (HTTP 403). | Could not revalidate an affected range or patched version. | Transitive build dependency. | No lock change or override without current evidence; recheck externally. |
| `js-yaml` via `@eslint/eslintrc` | 4.1.1 → 4.1.1 | Live npm advisory record unavailable (HTTP 403). | Could not revalidate an affected range or patched version. | Development lint configuration only; not shipped by the application. | No lock change or override without current evidence; recheck externally. |
| `brace-expansion` via `@eslint/eslintrc > minimatch` and `eslint-config-next > @typescript-eslint > minimatch` | 1.1.14 / 5.0.6 → unchanged | Live npm advisory record unavailable (HTTP 403). | Could not revalidate an affected range or patched version. | Development lint tooling only; not shipped by the application. | No lock change or override without current evidence; recheck both versions externally. |
| `postcss-selector-parser` via `tailwindcss` | 6.1.2 → 6.1.2 | Live npm advisory record unavailable (HTTP 403). | Could not revalidate an affected range or patched version. | Development/build CSS tooling only. | No lock change or override without current evidence; recheck externally. |

To close the external gate, fetch the latest `main`, consult the linked
maintainer notices plus the current Next.js and React security listings, run
`npm view` for the selected releases, and rerun both required online audit
commands. Record every resulting advisory and dependency path. If a current
critical/high issue has no supported Next.js 15.x resolution, stop and request
a separate Next.js 16 decision rather than extending this patch.

Rollback for this dependency-only patch is to revert its commit, restoring the
previous four manifest ranges and previous lockfile. There are no runtime code,
migration, environment, or data changes.

### Local verification results

- `npm ci`: exit 0 (504 packages installed from the exact lockfile).
- `npm audit --json`: exit 1; unavailable because the advisory endpoint
  returned HTTP 403, with no vulnerability counts.
- `npm audit --omit=dev --json`: exit 1; the same HTTP 403 transport failure,
  with no vulnerability counts.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npm run test`: exit 0; 105 total, 98 passed, 0 failed, 0 cancelled,
  0 skipped, and 7 pre-existing stabilization TODO tests. The authentication,
  server-action support code, and cron authorization/sync behavior remain
  covered by mocked deterministic tests; no production service was contacted.
- `npm run build`: exit 0 with Next.js 15.5.18.
- `git diff --check`: exit 0.

Because the audits and current official-source review are unavailable, and
because the repository's seven explicitly deferred stabilization tests remain
TODO, this record does not label either category as a passed release gate.

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
