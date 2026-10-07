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

Tested dependency/runtime/CI SHA: `63e82b0748d1507b4d0c1977eab100f0c2dd4bcb`.
Permanent sanitized results, migration history and cleanup are retained
in [task-13-evidence.json](task-13-evidence.json), copied from
[CI run 37607515359](https://github.com/dfalidas/matter-stats/actions/runs/37607515359)
(database artifact `11475504536`, attempt 1, completed 2026-10-07).
The final documentation/evidence commit is independently tested through both
jobs. Its exact tested SHA, final workflow/artifact link and results are recorded
in [PR #76](https://github.com/dfalidas/matter-stats/pull/76) and that workflow's
sanitized `ci.json`, `results.json` and `cleanup.json`; the checked-in evidence
above records the preceding fully validated dependency commit.

| Check | Actual outcome |
| --- | --- |
| `npm ci` | Passed locally and in CI with the existing lockfile |
| `npm run typecheck` | Passed after existing Next route type generation |
| `npm run lint` | Passed; three unchanged Visual Explainer warnings |
| `npm run test` | 232 passed, 0 failed, 3 existing TODOs (235 total) |
| `npm run build` | Passed locally and in CI |
| `npm run audit:ci` | Passed: 0 production vulnerabilities; 8 CI full-audit entries derive only from the existing permitted development advisory |
| Disposable fresh database | Catalog, real Data API grants, Task 12 SQL/runtime concurrency and Task 13 page/recovery suite passed |
| Disposable upgrade database | Same suites passed; full legacy rows, active Task 11 stream contracts/cooldowns and Task 12 lease owner/expiry/generation preservation passed |
| Disposable cleanup | Both stacks stopped, temporary directory removed; atomic fixture/trigger/Auth cleanup passed |

The hosted database job runs the regular tests and then explicitly runs
`DISPOSABLE_DB_ACK=yes npm run test:stabilization-db`, with runner-created
synthetic databases and no normal production/Matter credentials. Existing SQL,
Data API and runtime assertions are retained. The earlier local provisioning
attempt established no pass; passing database evidence comes from the hosted
runner, including its verified cleanup.

The previous audit blocker is resolved:
[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), affecting
`sharp <0.35.5`, was removed by changing the existing override from 0.35.4 to
0.35.5 and regenerating the lockfile through npm. Bundled sharp/libvips platform
packages update with it; other shared dependency entries remain unchanged.
Next.js remains 15.5.27, the Tailwind selector override remains 7.1.6, and the
audit policy is unchanged. No new advisory exceptions were added. The full audit
retains only GHSA-vfj7-8cjw-p6xm under the existing development policy (CI: 8
entries; local Node 24: 7); both environments report zero production findings.
A native sharp 0.35.5 PNG decode/resize smoke check passed. No production
deployment, migration, real Matter sync, secret change or personal-data mutation
was performed.

### Upgrade gateway investigation

The first attempt of [run 37603043220](https://github.com/dfalidas/matter-stats/actions/runs/37603043220/attempts/1)
on `77f2ff0521c218725967d1c66d07eed9d4590ddf` passed fresh verification but
failed during upgrade bounded-rollup acknowledgement. The Data API returned
`An invalid response was received from the upstream server` for
`/rest/v1/rpc/ack_matter_rollup`, without a PostgreSQL error code. Its failure and
cleanup artifact is retained as `11474320558`; both stacks stopped and the
temporary directory was removed. The same SHA's attempt 2 passed the database
job (`11474348645`). That retry does not establish a root cause: the original
artifact retained no gateway/container diagnostics. It is distinct from the
earlier deliberately raised `40001` retry issue fixed with `PT409`.

The new dependency commit passed both paths on attempt 1 without reproducing
the gateway error. No assertions were relaxed, test transport retries added,
gateway errors accepted as grant denials, or failure fixtures removed. Current
Supabase [local Kong load guidance](https://supabase.com/docs/guides/troubleshooting/kong-stops-responding-under-heavy-load-locally)
was reviewed; it does not establish that worker exhaustion caused this historical
failure. Any recurrence must remain a failing gate and be investigated with
disposable gateway/PostgREST diagnostics before release. The PR stays draft while
its final-head checks run.

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
