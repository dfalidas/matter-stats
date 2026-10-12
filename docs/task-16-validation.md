# Task 16: complete session retrieval

Scope: G1 / W5 / R5 session retrieval only. Latest `origin/main` was fetched
on 2026-10-12 and matched prompt baseline
`686e103f14f5d63529a2255f18cf657f3b7b5ce0` (merged Task 15, PR #78).
Branch: `codex/task-16-complete-session-retrieval`. The draft PR records the
final head SHA and final check results; older evidence is not final-head evidence.

## Defect and inventory

The three existing complete-session loops requested 500 rows and stopped on a
short page. A server cap of 100 therefore silently supplied only 100 sessions.
Other aggregate queries did not paginate at all. All complete session inputs
now use `lib/complete-session-query.ts` while retaining their caller filters,
projections, timezone ranges, rounding and attribution rules.

| Query path | Callers/purpose | Retrieval |
| --- | --- | --- |
| Metrics range and comparison | Overview, Reports and year-in-reading | Complete `[start,end)`; optional start |
| Metrics best/current/historical streak | Same callers; independent history cutoffs | Complete history before each existing end |
| Activity month | Activity calendar, selected-day totals and session list | Complete local month; visible pages still 20 rows |
| Reports timeline | Daily/weekly/monthly/yearly Reports and year-in-reading | Complete selected range; longform grouping/output unchanged |
| Authors/Sources/Tags session inputs | Legacy ranking pages | Complete existing range; existing newest-first consumption retained |
| Article source performance | Article detail's source comparison | Complete existing item-ID filter, including null timestamps |
| Daily-stat calculation | Normal dirty-rollup recovery/recalculation callers | Complete local day; existing exact annotation count unchanged |
| Article detail session preview | Article detail | Intentionally bounded `limit(25)`, unchanged |
| Reports latest-week discovery | Weekly report navigation | Intentionally bounded latest positive-duration dated session `limit(1)`, unchanged |

Session ingestion upserts/RPCs and upstream Matter list calls are writes or
upstream enumeration, not analytics Data API reads; they are unchanged.
`item_tags`, annotations, facets, source-item lists/large `in()` inputs and
embedded attribution completeness remain Task 17. Request reuse and aggregate
optimization remain Task 18. The broader R5 finding is not closed by this task.

## Pagination and exhaustion

Each caller provides a fresh filtered/projected Supabase query. The reader first
fetches the greatest matching `(started_at,id)` key, then traverses in ascending
`started_at NULLS LAST,id` order with strict keyset filters and a requested limit
of 500. When null timestamps exist, it separately pins the greatest dated key
and the greatest null-timestamp ID. This fences both segments against appends
beyond their initial maxima. Timestamp strings retain PostgreSQL microseconds;
opaque filter values quote and escape PostgREST reserved characters.

There is no offset or arbitrary total-row ceiling. Every nonempty page advances
from its last database row, even when a response cap makes it shorter than 500.
Only a successful empty query proves exhaustion (including an initially empty
boundary lookup). No exact/estimated count or page-length assumption is used.
The server's documented positive response cap may be below the requested limit.

All returned IDs must be nonblank and unique across the enumeration. Null
timestamps are valid for unfiltered source comparisons and sort in a separate
tail segment; SQL date comparisons exclude them from date-bound metrics.
Malformed/infinite timestamps, impossible calendar dates, missing/blank IDs,
null rows or non-array successful payloads fail explicitly. Duplicate IDs,
including repeated/no-progress pages or a previously fetched row moved forward,
reject the read rather than double-counting or looping. Invalid rows never
become pagination cursors. Nullable linkage and null/nonpositive duration retain
the existing metric behavior. Any database/transport failure, including a later
page, propagates through the caller's existing error path; no partial success
or partial daily-stat write is returned.

Official Supabase changelog and relevant Data API/Postgres breaking-change
notices were inspected. The existing table/API and dependencies are unchanged.
PostgREST explicitly permits shorter responses than requested; filter quoting
and logical composition follow its documented URL grammar:

- [Pagination and counts](https://docs.postgrest.org/en/stable/references/api/pagination_count.html)
- [Logical filters and ordering](https://docs.postgrest.org/en/stable/references/api/tables_views.html)
- [Reserved characters and escaping](https://docs.postgrest.org/en/stable/references/api/url_grammar.html)

## Consistency strategy and limits

This is a **fenced live enumeration, not an MVCC snapshot**. The maximum key
lookups and each page execute in separate database requests/transactions. Even
a timestamp upper bound does not freeze row versions. Each enumeration captures
its own maxima; Overview's multiple metric calls and Reports' separate timeline
call do not share a transaction or generation. This task adds no schema, lease,
write lock, materialized snapshot or shared-query optimization.

For an unchanged matching dataset, every ID is retrieved exactly once regardless
of response cap. With concurrent changes:

- Inserts beyond the captured dated/null maxima are excluded. Backdated/tied
  inserts ahead of the cursor and within the fence can appear; inserts behind
  the cursor are omitted. An initially empty read stays empty.
- A fetched row deleted later remains in the in-memory result. Deleting an
  already-fetched row does not shift or skip unseen rows. An unseen deletion is
  omitted, so the result is not the original start-of-read dataset.
- A payload update is observed if it commits before that row's page. Previously
  read values stay as read. Moving an unseen key behind the cursor can omit it;
  moving a read ID ahead within the fence is detected as a duplicate and fails.
  Moving keys/filters outside the fence can remove rows from the traversal.

Tests exercise these supported outcomes and limitations, including separately
fenced null/dated appends. Cross-view agreement is proven for unchanged synthetic
data, not promised during concurrent writes. A strict start-of-request snapshot
would require a separately designed database snapshot mechanism. Live database
and production behavior remain unverified; mocks do not establish deployed caps,
grants, collation, query plans, performance or migration state.

## Executable acceptance

`tests/fixtures/capped-postgrest.ts` runs the installed Supabase client against
an in-memory HTTP fixture, evaluating its serialized filters/order before applying
the response cap. It never contacts Supabase or Matter. Expected IDs and totals
are independently constructed from the original fixtures, not a copy of the
pagination helper. Existing query tests now use this same cap-aware fixture.

`complete-session-services.test.ts` and `complete-session-server.test.mjs` cover:

- 1,200 unique sessions × 60 seconds: **1,200 / 72,000 seconds / 270,000 words**
  under server caps **100, 300 and 1,000** (request size 500).
- **10,037 unique sessions / 602,220 seconds / 2,258,325 words**, cap 100.
- Complete Report timeline IDs and unique counts, Overview selected/today/all-time
  totals, Activity month/day totals and first/last visible pages, and CSV totals.
- Empty datasets, exact 100/500/600 multiples, final partial pages, shuffled
  input with timestamp ties spanning every page, microseconds and quoted IDs.
- Null links/timestamps/durations, nonpositive durations and per-session word
  rounding; independent streak history; existing local boundary/DST/year tests.
- Invalid keys/calendar rows, duplicate/repeated pages, malformed response and
  later database errors; concurrent inserts, updates, deletes and moved keys.
- Authors/Sources/Tags with one attributed item/tag (no claim about large joins);
  actual daily-stat queries and complete article source comparison while its
  preview stays 25 rows; bounded weekly latest-row lookup.

The R5 **session-retrieval** target is active in
`stabilization-regressions.test.ts` and calls the actual metrics service under
cap 100. Separate facet/join and query-efficiency targets remain TODO.

## Validation and impact

Final checks and counts are recorded below and in the draft PR. `next typegen`
was run before typecheck, following CI's generated-route-type prerequisite.
The initial sandbox could not reach the configured proxy or fully exercise Node
child processes; authorized command execution was used for network/process checks.
Initial implementation checks found missing generic annotations, unsupported
BigInt literal syntax under the repository target, an omitted test compile entry
and an unrealistic fractional integer-duration fixture. These were corrected;
earlier failures are not acceptance evidence. The fixture evaluator was sped up
without altering production queries after redundant slow runs were stopped.

No migration, dependency/lockfile, environment contract, authentication, cron,
sync/quota/retry/checkpoint/lease, repair/backfill or interface change. Source
comparison and daily-stat projections add only pagination keys. Session reads
now make as many bounded requests as needed and retain all matching rows in
memory; very large histories can still face runtime/memory limits, which fail
rather than certify a truncated total. Query optimization is Task 18.

Rollback is a code revert of this focused Task 16 commit (under a separately
authorized release procedure); no database undo, data rewrite, environment change
or state reset is needed. Reverting reintroduces truncated analytics, so prefer
roll-forward. Existing Task 15 sync/migration rollback restrictions still apply.
No production SQL, real Matter sync, deployment, token rotation or merge was run.

### Results

- **Passed:** `npm ci`, generated Next.js route types, `npm run typecheck`,
  `npm run lint` (three preexisting Visual Explainer warnings), `npm run test`,
  `npm run build`, `npm run audit:ci`, `git diff --check`. Final test result:
  **288 passed, 0 failed, 0 cancelled, 0 skipped, 2 TODO (290 total)**. Audit:
  **0 production vulnerabilities**; full audit has **7 high finding entries**,
  all covered by the unchanged development-only `GHSA-vfj7-8cjw-p6xm` exception.
- **Failed:** none on final validation; initial corrected failures listed above.
- **Blocked:** none for required Task 16 local checks. Live/deployed correctness
  is unverified, not inferred from this synthetic evidence.
- **Skipped:** opt-in fresh/upgrade disposable database validation (no schema,
  migrations, grants or security objects changed; `DISPOSABLE_DB_ACK` not set).
  Production access/sync/backfill/repair/deployment/merge intentionally not run.
- **TODO:** two executable placeholders for Tasks 17–18; deployed Data API/caps,
  performance and cross-view consistency under live writes remain external gates.
