# W1–W3 security release runbook

## Dependency note (2026-09-29)

The lock contains Next.js/eslint-config-next 15.5.18, React/React DOM 19.2.6 and Supabase JS 2.105.4. Attempts to query official web documentation and the npm registry/audit API were rejected by the environment (401/403). Consequently W2 is **unverified**, not declared vulnerability-free, and no guessed downgrade/upgrade was made. Re-run `npm view next@15 version`, review official Next.js and React advisories, and run `npm audit` from an authorized network before release; select the smallest supported patched 15.x target or request approval for a major.

## Required configuration

- Existing: `APP_ACCESS_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MATTER_API_TOKEN`, `CRON_SECRET`.
- New: `APP_CREDENTIAL_VERSION=1`. Increment it to revoke every existing app session after an access-password rotation. This does not rotate the Matter token.
- `x-forwarded-for`'s first address is the limiter key because Vercel supplies that boundary. On another proxy, normalize/overwrite it at the trusted edge. Five failed attempts per key in 15 minutes are permitted; state is shared in Supabase. Unknown/missing addresses share the `unknown` bucket.

## Pre-deploy on an isolated Supabase project

1. Restore/synthesize the previous schema, then apply `20260929000000_harden_rls_and_auth.sql`; also test a fresh migration chain.
2. Through the real Data API, attempt SELECT/INSERT/UPDATE/DELETE on every inventoried table with `anon` and a normal `authenticated` JWT. Verify no rows are returned/changed (do not rely on HTTP status alone). Verify the trigger function cannot be invoked.
3. With the service-role key, create/read/revoke a disposable app session and exercise ordinary application queries. Delete the disposable project/data afterward.
4. Run `supabase/audit/stabilization-read-only.sql`; retain sanitized results. Run all application checks and inspect client chunks for secret values/names.

## Controlled deployment (requires separate approval)

Backup/export affected schema/data; apply the additive migration; add `APP_CREDENTIAL_VERSION`; deploy the reviewed commit; log migration and commit identifiers; sign in, access a dynamic/dotted article path, log out, confirm replay rejection, and test cron with missing/wrong/correct Bearer secret. Run the read-only audit and Supabase Security Advisor. Do not mutate personal production data merely to test RLS.

Existing deterministic cookies become invalid, so one fresh login is expected. Raw reading/library data is unchanged. The new tables contain only hashes and timestamps.

## Rollback

Prefer rolling code forward. Code rollback requires restoring compatibility with the old cookie and should only happen after security review; do not disable RLS as a routine rollback. The additive auth tables may remain unused. Dropping them loses revocation/limiter history and is a separately approved destructive action. Restore from backup only if migration integrity fails.
