# Task 13 validation: atomic pages and crash-safe recovery

Base: `d48491dcc51b2e9fca3d901f5c849643a3524951`, fetched from origin/main;
includes merged account lease/fencing PR #74 and Visual Explainer PR #75.
Migration: `supabase/migrations/20261007085051_atomic_matter_page_commit.sql`.
Applied migrations are unchanged. See architecture.md's Task 13 section for the
transaction, receipt and marker contracts, and deployment.md for release order.

## Invariants and replay

Page preparation validates the upstream envelope and continuation before any
page writes. Bounded normalization includes accepted items/placeholders, sessions,
tags, replacements and annotations. One SQL transaction locks/asserts the lease,
locks/compares the persisted cycle contract and cursor, applies dependencies,
derives old/new local dates, persists dirty revisions and advances/completes only
that stream. Any exception rolls back all page effects. No HTTP or rollup
calculation occurs inside that transaction.

Latest receipt per stream is bounded to two rows. Exact uncertain-response retries
are read-only and require a current lease. Replaced receipts must pass the durable
contract/cursor comparison; delayed workers cannot rewind or replace newer cycles.
Stable external keys and replacement joins make overlap re-import idempotent.
Database UUID marker revisions distinguish multiple commits within one lease.
Exact-revision daily persistence/ack is one fenced transaction; obsolete results
cannot overwrite rollups or clear newer work. Up to 32 markers are processed per
recovery call; excess work remains pending. Recovery runs before upstream work
and after commit, including empty terminal pages and account cooldowns.

## Acceptance evidence

The full disposable fresh/upgrade entry point compiles the real application and
runs existing security/Task 12 concurrency/lock tests plus the new atomic suite.
Its synthetic Matter fixtures cover both streams, optional and embedded metadata,
placeholder behavior, accepted joins/annotations, null attribution and per-row
skip diagnostics. Disposable SQL triggers/barriers establish rollback after writes
and at checkpoint persistence. Real SQL responses are consumed then lost to prove
receipt replay. Dirty-work interruption, exact revision acknowledgement, work
bounds, timezone movement, unchanged rows, invalid/oversized plans, expiry/takeover
and real browser-role object denials are asserted. Cleanup removes owned synthetic
fixtures/triggers/Auth users and stops only runner-created stacks.

Upgrade compares full legacy rows through the migration chain, active Task 11
contracts/cursors/watermarks/coverage/cooldowns through Task 12, and active Task 12
owner/expiry/generation plus stream state through Task 13. It does not reset
production state or derive unsupported completion claims.

Tested runtime SHA: `b6b53e56afc96653d85f03c0c92df6e89c451ae2`.
The subsequent evidence/documentation commit changes no runtime, migration or
test code. Permanent sanitized results, migration history and cleanup are retained
in [task-13-evidence.json](task-13-evidence.json), copied from
[CI run 37601808504](https://github.com/dfalidas/matter-stats/actions/runs/37601808504)
(database artifact `11473063007`, attempt 1, completed 2026-10-07).

| Check | Actual outcome |
| --- | --- |
| `npm ci` | Passed locally and in CI with the existing lockfile |
| `npm run typecheck` | Passed after existing Next route type generation |
| `npm run lint` | Passed; three unchanged Visual Explainer warnings |
| `npm run test` | 232 passed, 0 failed, 3 existing TODOs (235 total) |
| `npm run build` | Passed locally and in CI |
| `npm run audit:ci` | Failed under the unchanged policy; see blocker below |
| Disposable fresh database | Catalog, real Data API grants, Task 12 SQL/runtime concurrency and Task 13 page/recovery suite passed |
| Disposable upgrade database | Same suites passed; full legacy rows, active Task 11 stream contracts/cooldowns and Task 12 lease owner/expiry/generation preservation passed |
| Disposable cleanup | Both stacks stopped, temporary directory removed; atomic fixture/trigger/Auth cleanup passed |

The hosted gate ran `DISPOSABLE_DB_ACK=yes npm run test`, which invokes the same
disposable orchestrator as `DISPOSABLE_DB_ACK=yes npm run test:stabilization-db`,
with runner-created synthetic databases and no normal production/Matter credentials.
The separate local `test:stabilization-db` attempt was cancelled during slow
provisioning before it established any pass; its owned stack was stopped and
temporary directory removed. That attempt is explicitly **not** passing evidence.

Release remains blocked: production audit reports high-severity
[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), affecting
the existing `sharp` 0.35.4 override (`<0.35.5`) and its dependent `next` entry
(two affected production packages). No dependency, audit policy or exception was
changed to obtain a pass. Resolve the dependency advisory separately and rerun
the required audit before release; this PR is not release-ready. No production
deployment, migration, real Matter sync, secret change or personal-data mutation
was performed.

## Limits and operations

Bounds: Matter pages 1–100; normalized items/placeholders/sessions and replacement
IDs 100 each; tags/joins/annotations 10,000 each; serialized page/plan 4 MiB;
opaque cursors 4,096 characters; annotation enrichment 100 requests and 10,000 raw
rows across a page. Metadata-dependent historical session effects are capped at
10,000 matching rows; a larger effect set rejects the page instead of losing work.
Two recovery calls per invocation process at most 64 markers. A failed calculation
can leave the oldest marker pending and delay further work until a later invocation.

This preserves current daily metric formulas, normalization, raw IDs/durations/
timestamps, timezone behavior, seven-day overlap and one-page invocation behavior.
It does not certify analytics completeness, remove existing Data API row limits,
add multi-page continuation/shared rate limiting/backfill, recompute history, or
repair abandoned run logging. Very slow upstream requests still lose the Task 12
lease at the response boundary. Administrative/service-role direct table writes
remain trusted; all old writers/previews must be disabled and drained for rollout.

Apply the migration before compatible code and preserve additive tables during
rollback. An older code rollback must keep sync disabled; leave committed stream
progress and pending work for a restored compatible runtime. Production actions
remain a separate authorized operation.

## Official documentation review

Reviewed current Supabase changelog index, database functions, JavaScript rpc,
securing-your-api grants, and the 2026-04-28 change to explicit Data API exposure.
The recent Postgres maintenance breaking-change notice was inspected; this task
does not upgrade database engine versions, CLI version, Realtime or GraphQL.
New objects explicitly grant intended service access and revoke PUBLIC/browser
access rather than relying on defaults. CLI migration naming was generated by the
pinned runner CLI's `migration new` after inspecting its help.

Sources: [functions](https://supabase.com/docs/guides/database/functions),
[rpc](https://supabase.com/docs/reference/javascript/rpc),
[Data API security](https://supabase.com/docs/guides/api/securing-your-api),
[exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically),
[Postgres notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes),
[changelog](https://supabase.com/changelog).

Replay also compares the receipt that preceded preparation, so an old page cannot
be accepted if an opaque cursor value recurs within the same cycle. The latest
receipt remains bounded; a reused-cursor SQL regression verifies this guard.
Stale contract conflicts use `PT409`, not `40001`: the current official
[PostgREST retry advisory](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b)
documents infinite retries for deliberately raised serialization failures in
PostgREST 14. The disposable Data API gate exposed this behavior; contract
conflicts now return a bounded HTTP 409 without retrying the SQL transaction.
