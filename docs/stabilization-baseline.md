# Stabilization baseline — W0

## Repository baseline

- Branch `work`, HEAD `bd4966c95d56132d9dfbcd213714f2225c8ac89f`; this is exactly the reviewed commit, so there is no commit delta to classify.
- Initial worktree was clean. No repository-scoped `AGENTS.md` exists (the only match is dependency-local `node_modules/recharts/AGENTS.md`, outside touched source scope).
- Locked versions: Next.js 15.5.18, React/React DOM 19.2.6, eslint-config-next 15.5.18, Supabase JS 2.105.4.
- Baseline passed 80 tests, typecheck, lint and production build before implementation.
- Eight existing migrations define nine app tables (including nullable `reading_sessions.item_id`) but no migration enabled RLS or restricted grants.
- Production database, Security Advisor, row counts, deployed Vercel commit, live Matter sample and production cursor state were not accessed. They remain unverified rather than inferred.

## Finding status at baseline / after this package

| ID | HEAD evidence | Delivery status |
|---|---|---|
| R1 | No RLS/grant statements in prior migrations | Code ready, production pending: new object-scoped migration/audit SQL; disposable Data API test still needs a Supabase test project |
| R2 | Lock has Next 15.5.18 and React 19.2.6 | Verification blocked: official web/registry/audit endpoints returned 401/403 in this environment; no unsupported speculative dependency change made |
| R3 | Recent activity processes one bounded API page and defaults to current-year window | Verified open; deferred to W4 by instruction |
| R4 | Singleton state combines modes/cursors and has no lease/fencing | Verified open; deferred to W4 |
| R5 | Analytics services collect unpaginated Supabase result sets | Verified open; deferred to W5 |
| R6 | Streak calculation is based on selected period rows, not canonical today | Verified open; regression requirement recorded; deferred to W5 |
| R7 | Normalizer/test explicitly chooses item `word_count × progress` for a session | Verified open; regression requirement recorded; deferred to W5/W6 |
| R8 | Metrics default Europe/London while rollups use UTC dates | Verified open; deferred to W5/W6 |
| R9 | Deterministic HMAC cookie had browser-only expiry, no revocation and no limiter | Code ready, production pending: opaque hashed DB sessions, server TTL/revocation/version and persisted limiter implemented |
| R10 | 80 unit tests; no isolated DB authorization suite/CI; large orchestration remains | Partially improved for auth/contract docs; broader work deferred to W4–W7 |

## Synthetic regression inventory

Existing fixtures already expose nullable links, API alias shapes, pagination flags, current-year resets, word-count/progress behavior and London timezone behavior. W0 keeps those passing as characterization tests. New W3 tests cover hashed opaque tokens, expiry, revocation, credential-version invalidation, malformed tokens, fail-closed storage and shared limiter state. R3–R8 behavior changes are intentionally not implemented or started before W4/W5; their target fixtures are specified in `docs/stabilization-plan.md`.

## Read-only / access classification

**Done locally:** source/schema inventory, baseline commands, contract matrix, additive migrations, read-only audit query, auth behavior fixtures. **Not checked:** live Matter response and current official docs due authorization failure; package registry advisories due 403. **Blocked on authorized external access:** production RLS/grants/advisor, counts/timestamps/duration/null ratio, latest run/cursors, deployment-to-commit match, real Data API denial checks and service-role allowance.
