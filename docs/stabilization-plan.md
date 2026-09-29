# Matter Stats — stabilization plan

**Version 1.1 · 2026-09-29.** This file preserves the implementation plan supplied for the stabilization assignment. It supersedes version 1.0 and is a plan, not evidence that production has changed.

## Objective and authority

Keep the existing Next.js, TypeScript, Supabase and Vercel single-user application. The desired outcome is protected access, loss-resistant imports, auditable analytics, and visible freshness/completeness. Local code, migrations, tests, documentation and commits are authorized. Push, merge, production deployment, production mutation/recomputation, secret rotation, paid infrastructure, and inferred session-to-item links are not.

## Findings tracked

R1 missing RLS hardening; R2 locked framework security baseline; R3 one-page/year-reset session sync; R4 shared cursor/no lease; R5 unpaginated analytics; R6 period-end rather than today streak; R7 per-session item word-count multiplication; R8 London/UTC timezone inconsistency; R9 non-expiring static app cookie/no shared limiter; R10 incomplete integration coverage and stale documentation.

## Work packages and dependency order

| Package | Deliverable | Depends on | Completion gate |
|---|---|---|---|
| W0 | Baseline, official API capability contract, synthetic regressions and read-only audit | — | HEAD and gaps recorded |
| W1 | RLS, object-scoped grants, RPC/view audit | W0 | isolated Data API denial plus service-role success |
| W2 | Smallest supported security dependency update | W0 | official advisories recorded; install/checks green |
| W3 | Hashed opaque sessions, expiry/revocation/versioning, shared limiter, guards | W1–W2 | auth and cron behavior tests green |
| W4 | Independent stream state, budgets/rate limiter, durable continuation and fenced lease | W1–W2 | resume/concurrency/fault tests |
| W5 | Complete queries and unified metric/time contracts | W0; W1 for RPCs | large-data/timezone tests |
| W6 | Versioned reversible derived-data recomputation | W4–W5 | dry-run/reconciliation preserves raw data |
| W7 | Status UX, alert semantics, docs and CI | earlier tests | understandable freshness/capability state |
| W8 | Staging and controlled release gates | release scope | deploy/rollback evidence |
| W9 | Optional contract-supported library metadata proposal | after stabilization | separately approved scope |

The first security release is W1–W3, followed by W4–W7 reliability work. This assignment stops before W4.

## W0

Inspect instructions, branch/HEAD/dirty state, migrations, lock and scripts; compare the reviewed commit; run unchanged checks; add synthetic regressions for R3–R8; prepare a read-only schema/RLS/grants/data/cursor audit; separate verified, unverified and access-blocked facts; and record the Matter API contract. A read-only live sample may validate implementation only when already authorized and never expands the documented contract.

## W1

Inventory only app-owned objects. Add (do not rewrite) a migration enabling RLS and removing `PUBLIC`, `anon`, and `authenticated` privileges without permissive policies. Restrict functions/views/RPCs, prefer invoker semantics and safe qualified definer functions. Preserve service-role server access. Test real anonymous/authenticated Data API reads and mutations in a disposable database and verify service operations. Production remains **code ready, production pending** until independently checked.

## W2

Use installed/locked versions and current official Next.js/React advisories. Select the smallest safe supported release; no blind forced audit or unapproved major. Record applicability/residual risk. Require reproducible install, typecheck, lint, tests, build, auth/cron smoke checks and a client-bundle secret check.

## W3

Retain password UX. Store only hashes of cryptographically random opaque session tokens with creation, 30-day server expiry, revocation and credential version. Logout revokes the current session; incrementing `APP_CREDENTIAL_VERSION` invalidates older sessions. Cookies are HttpOnly, production-Secure, SameSite and path-scoped. Use a database-backed per-client limiter (not process memory), document trusted IP semantics, and fail closed on storage error. Middleware is an early redirect only: every protected read/action is guarded. Public paths are explicitly allowlisted; cron remains independently protected by `CRON_SECRET`. App sessions, cron secret and the single Matter token are distinct; do not rotate Matter here.

## W4–W9 (deferred, not started)

W4 must separate `recent_sessions` and `library_items` checkpoints, preserve fixed endpoint filters with opaque cursors, use 7-day overlap policy, ≤100 pages, account-wide 120 GET/min and 5/sec limits, bounded runtime, durable partial state, idempotent writes, sanitized failures, and an atomic expiring fenced lease. W5 must paginate/aggregate complete datasets and adopt Europe/Athens calendar helpers, today-based streaks, 225-WPM session estimates and explicit unavailable article attribution/completion. W6 must version and dry-run reversible derived rollups without changing raw IDs/durations/UTC timestamps. W7 adds freshness/coverage/capability UX, a configurable 36-hour stale threshold, CI and operational documentation. W8 requires fresh/upgrade migration testing, isolated staging, backup/deploy/rollback ordering and explicit production approval. W9 is only a later proposal for documented library metadata endpoints; no inferred linkage.

## Definition of done and reporting

Evidence must cover RLS/RPC denial and server allowance; auth expiry/revocation/version/limiting/direct access; cron rejection and authorization; sync semantics/concurrency/recovery; >1,000 and >10,000-row query completeness; metric/time boundaries; reversible repair invariants; truthful missing-versus-zero UX; CI and runbooks. Each package reports files, R IDs, exact tests, migrations/env/operations, data/rollback impact and remaining evidence. Never call production-complete while live policies, deployment, recomputation, or scheduled cycles remain unverified.

## Official sources and application-policy boundary

Matter sources: [overview](https://docs.getmatter.com/api), [sessions](https://docs.getmatter.com/api/reading-sessions/list), [items](https://docs.getmatter.com/api/items/list), [item](https://docs.getmatter.com/api/items/get), [update](https://docs.getmatter.com/api/items/update), [pagination](https://docs.getmatter.com/api/pagination), [limits](https://docs.getmatter.com/api/rate-limits), [authentication](https://docs.getmatter.com/api/authentication), [errors](https://docs.getmatter.com/api/errors), [versioning](https://docs.getmatter.com/api/versioning), [annotations](https://docs.getmatter.com/api/annotations/list), and [tags](https://docs.getmatter.com/api/tags/list). The 225 WPM, 7-day overlap, Europe/Athens timezone, 30-day session TTL and 36-hour stale threshold are application policies, not Matter guarantees.
