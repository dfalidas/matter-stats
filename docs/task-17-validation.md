# Task 17: complete Library facets and metadata joins

Scope: G2 / W5 / R5 only. Fetched latest `origin/main` on 2026-10-12:
`1a5b24e1390cf31c7f524fa05a352f6d59b04562` (merged Task 16, PR #79),
exactly matching the supplied baseline. Branch:
`codex/task-17-complete-library-metadata`. The draft PR records the final head
SHA; a document inside that commit cannot contain its own commit hash.

## Query inventory

All entries below were inspected at the baseline. Unless explicitly described
as bounded, these inputs intend complete retrieval. Database/transport errors
continue to throw through their callers; complete reads now also reject invalid
arrays/identities, duplicate rows, repeated pages and cross-batch duplicates.
No caller returns partial success after a later page/batch failure.

| Caller / purpose | Filters and selected fields | Baseline ordering / unique key | Final retrieval / large IDs |
| --- | --- | --- | --- |
| `articles-service.fetchArticleSourceFacets` / global Library source counts | Global items, source not null; previously `source`, now `id,source`; existing trim/blank normalization, one count per item | `source`; key is item `id`, absent from baseline projection | Complete offsets, `source ASC,id ASC`; count original items once, independent of visible filters/pages |
| `fetchArticleTagFacets` / global Library tag options | Global tags; `id,name`; no new tag count contract | `name`; key `id` | Complete offsets, `name ASC,id ASC`; existing labels/scope retained |
| `fetchItemIdsForTag` → `getArticleList` / selected-tag membership | Previously `item_tags.item_id WHERE tag_id=tag`, then unbounded item `in()`; now existing FK `item_tags!inner(tag_id)` with `item_tags.tag_id=tag` | Relation key `(item_id,tag_id)`; baseline unordered/capped membership | Removed separate ID enumeration; server semi-join filters parent items before exact count and range; no batch page concatenation |
| `getArticleList` / visible Library page | Existing item fields `id,title,url,source,author,status,word_count,estimated_reading_time_minutes,progress,created_at_matter,updated_at_matter`; optional period `[start,end)` on created time, title/source/author ilike, source, tag, status, author, content type, size | Created time DESC NULLS LAST, updated time DESC NULLS LAST; key `id` | **Bounded 100-row page**, same offsets and global matching exact total; adds `id ASC` after timestamp fields. Query-only tag embed is stripped from public rows |
| `fetchTagsByItemId` / Library rows and detail | Visible item IDs or one detail ID; `item_id,tag_id,matter_tags(id,name)` (adds actual tag key) | Baseline unordered; actual composite key `(item_id,tag_id)`, no `id` column | Deduplicated encoded-size ID batches, every batch completely offset-paginated; `item_id ASC,tag_id ASC`; object/array/null tag shape handling retained |
| `fetchHighlightCounts` / per-visible-item highlights | Visible item IDs; previously `item_id`, now `id,item_id`; no annotation date filter | Baseline unordered; annotation key `id` | Encoded-size ID batches, complete offsets ordered by `id`; each annotation counted once |
| `getArticleDetail` / complete annotations | Exact item ID; `id,text,note,created_at_matter` | Created time ASC NULLS LAST; annotation key `id` | Complete offsets, created time ASC NULLS LAST then `id ASC`; nulls/ties/microseconds retained |
| `getArticleDetail` / item and session preview | Item `* WHERE id=...`; sessions `id,started_at,duration_seconds,words_estimated,source_device WHERE item_id=...` | Item key `id`; preview started time DESC NULLS LAST | Item remains singleton; **session preview remains limit 25**, independent of source totals |
| `fetchRelatedArticles` / detail preview | Same trimmed/exact source, excludes current ID; `id,title,source,author,created_at_matter,updated_at_matter,estimated_reading_time_minutes` | Created/updated time DESC NULLS LAST; key `id` | **Limit 5 unchanged**; never defines complete source membership or totals |
| `fetchSourcePerformance` / detail source comparison | Complete items `id WHERE source=trimmedSource`; then sessions `id,started_at,item_id,duration_seconds WHERE item_id IN sourceIDs`, no date filter | Item baseline unordered, key `id`; sessions Task 16 `(started_at,id)` dated/null fences | Source IDs complete by `id` offsets; deduplicated encoded-size ID batches, each completely read with unchanged Task 16 keyset reader. Denominator remains all source items including unread ones; null session timestamps retain time |
| `metrics-service.fetchTagsByItemId` / Metrics tag ranking inputs | Distinct usable selected-range session item IDs; `item_id,tag_id,matter_tags(id,name)` | Baseline unordered; composite relation key | Complete ordered/batched relation reads; existing trimming, grouping by tag name, ranking limits and metric definitions retained |
| `tags-service.fetchItemTags` / legacy tag rankings | Distinct usable selected-range session item IDs; `item_id,tag_id,matter_tags(id,name)` | Baseline unordered; composite relation key | Complete ordered/batched relation reads; same object/array/null normalization |
| `fetchTagAnnotations` / tag highlights | Same session-derived item IDs; `[start,end)` on annotation created time, optional lower bound; `id,item_id,created_at_matter` | Baseline unordered; key `id` | Complete offsets by `id` in each ID batch; one highlight ID per tag, global tagged highlights count once |
| `sources-service.fetchSourceAnnotations` / source highlights | Same session-derived usable IDs and annotation range; `id,item_id,created_at_matter,matter_items(id,source)` | Baseline unordered; key `id` | Complete offsets by `id` in each ID batch; source trimming and unique highlight sets unchanged |
| Authors/Sources/Tags/Metrics/Activity/Reports complete sessions | Existing filters/projections and half-open session ranges | Task 16 `(started_at,id)` with dated/null upper fences | Task 16 helper unchanged. Only source-performance item filtering is batched; no inferred linkage or altered time/word formulas |
| `daily-stats.calculateDailyStat` / daily annotation total | Annotation `[localDayStart,localDayEnd)`; `id`, exact HEAD count | Count, no traversal key necessary | SQL exact count is independent of response cap; errors/missing/invalid counts reject calculation instead of falling back to zero |
| Overview current-item card, `getRecentMatterItems`, Reports latest-session discovery | Dashboard item fields limit 4; recent item `*` configurable limit (default 10); latest positive-duration dated session limit 1 | Existing timestamp ordering; unique item/session IDs | **Intentionally bounded, unchanged** |
| `metadata-coverage.hasSessionMetadataCoverage` | Presence of top source/author/tag arrays | No database query | Existing presence/empty-state contract unchanged; no completeness percentage inferred from bounded rankings/previews |

Settings item/session/unlinked/daily counts use exact HEAD counts, not row
collection. Settings/sync-run lookups, stream singletons (two rows), receipts,
continuation and authentication reads are operational/singleton/bounded queries,
not Library metadata enumeration. Supabase `daily_stats` summary/trend helpers
are rollup queries outside this metadata task. Ingestion/upsert/RPC and upstream
Matter calls are unchanged. All runtime `in()` sets targeted here were replaced;
Settings' two fixed sync-mode values are intentionally small.

## Retrieval, identity and request strategy

`lib/complete-metadata-query.ts` supplies the two small mechanisms:

- Complete metadata reads request 500 rows with explicit deterministic caller
  ordering, advance the offset by the **actual database row count**, and stop only
  after a successful empty page. No short-page exhaustion or total-row ceiling.
- ID inputs are deduplicated and split at **100 IDs or 6,000 encoded filter bytes**,
  whichever comes first. Size includes quoted/escaped values, separators and the
  `item_id=in.(...)` parameter serialized with `URLSearchParams`, as in the
  installed Supabase builder. This reserves room for these callers' fixed
  projections/date filters/order/pagination. Synthetic acceptance enforces an
  8,000-byte full URL ceiling for the tested requests. This is an application
  budget, not a claimed universal proxy limit. A single ID exceeding the filter
  budget rejects explicitly before requests; it is never dropped or truncated.

Every production batch callback completely paginates its query. Result identities
are checked across pages and batches. Single-table metadata and annotations use
`id`; `item_tags` uses JSON-encoded `(item_id,tag_id)`, preserving both multiple
tags per item and multiple items per tag. No `item_tags.id` is assumed.

The installed `.in()` implementation quotes reserved-character values but does
not escape embedded quotes/backslashes. These callers instead use `.filter`
with a documented quoted/escaped `in` expression. Logical ilike values are also quoted/escaped; the existing text pattern
normalization is retained. Standalone scalar `eq`/`neq` values remain literal,
as in the baseline: quotes there are data, not delimiters. The fixture explicitly
distinguishes scalar filters from logical/in quoting. Supabase handles URL
encoding, without double encoding.

Selected-tag Library pages use the existing server relationship/inner embed.
PostgREST filters parent rows before count/range without multiplying them by
child rows. Exact totals, global timestamp/ID order, other filters and first,
middle and final visible pages remain correct regardless of matching-ID count.
No schema/RPC/grant change or response-capped ID membership list is needed.

Current official docs and Supabase changelog were fetched and inspected on
2026-10-12 before selecting these APIs. The Data API auto-exposure change leaves
existing tables/grants intact; the September PostgreSQL notice concerns ltree,
legacy pgcrypto PGP ciphers, btree_gist float/NaN and custom operators, none added
by this change. No upgrade/advisor query was run against a real database.

- [Supabase range semantics](https://supabase.com/docs/reference/javascript/range)
- [PostgREST shorter responses and exact counts](https://docs.postgrest.org/en/stable/references/api/pagination_count.html)
- [PostgREST reserved-character escaping](https://docs.postgrest.org/en/stable/references/api/url_grammar.html)
- [PostgREST inner embeds and parent filtering](https://docs.postgrest.org/en/stable/references/api/resource_embedding.html)
- [Scalar versus logical filter quoting](https://github.com/PostgREST/postgrest/issues/1943)
- [Supabase changelog](https://supabase.com/changelog)
- [Data API auto-exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [PostgreSQL September changes](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)

## Consistency limitations

These are **ordinary live multi-request reads, not an MVCC snapshot**. On an
unchanged matching dataset, completeness and uniqueness hold under positive
response caps. Offset ordering is deterministic but mutable data is not frozen:

- An unseen payload update is observed when its page is read. Previously read
  values stay in memory. An already-read deletion stays in that result.
- Deletes before the next offset can shift and omit unseen rows. Inserts or sort
  updates before that offset can shift a previously read row into a later page;
  a repeated identity rejects the whole result. A new unique row can otherwise
  appear or be omitted depending on its insertion position. Appends can extend
  the live enumeration until an empty response; no fixed initial total is claimed.
- Changes between separate ID batches can change relation membership; repeated
  annotation/session IDs across batches reject rather than double-count. Unseen
  changes/removals need not be detectable. Facets, parent page and joined metadata
  are separate requests and can represent different instants during sync writes.
- One server-side selected-tag page applies join/filter/count/range together;
  it does not make other pages, facets or service calls share a database snapshot.
- Source sessions retain Task 16's independently fenced dated/null traversal for
  every batch. Its existing live consistency limits still apply; the complete
  source-item list and each session batch do not share a snapshot.

Executable tests demonstrate offset update/delete/insert outcomes, including an
explicit unseen-row omission after a delete. They do not claim snapshot behavior.
Strict snapshot consistency would need a separate database design; no locks,
rollups, historical repair, query reuse or Task 18 optimization was added.

## Acceptance evidence

The installed Supabase JS query builder executes against the extended synthetic
HTTP fixture. It evaluates filters/order, the existing FK parent semi-join and
selected projections, enforces caps/URL size, and counts **before** row slicing.
Expectations derive directly from original entities/relationships and their
metric values, not production traversal/batching or fixture query evaluation.

`complete-metadata-services.test.ts`, `complete-metadata-server.test.mjs` and the
active R5 facets/joins regression cover:

- Caps **100, 300 and 1,000** below/above the requested 500-row metadata size;
  1,205 Library items, 1,206 tags, and one item's 1,206 relations/highlights.
- **10,037 items**, **10,038 tags**, **21,278 composite relations**, and **11,242
  annotations**; complete global facets, final Library page, source/tag highlight
  metrics and every Metrics/tag ranking input checked independently.
- Global selected-tag first/middle/last pages and exact total, nullable/tied item
  timestamps, shared sources/tags, source normalization, all retained filters,
  missing tags and empty Library results.
- Annotation null tails, timestamp ties and microseconds, per-item complete tag
  and highlight counts, relation object/array/null shapes and null metadata.
- Deduplicated inputs, many ID batches, reserved characters including quotes,
  backslashes, commas, parentheses and Unicode, and 700-character IDs splitting
  on encoded bytes below the ID-count ceiling; oversize single-ID rejection.
- Empty/exact/final partial pages, actual returned-row offset progression,
  malformed/invalid responses, duplicate/missing composite keys, repeated pages,
  cross-batch duplicate IDs and later-page/batch database failures through actual
  Library, Metrics, source/tag ranking, detail and source-performance services.
- Complete source performance including unread items in the denominator and
  null-timestamp sessions; unlinked session time retained without attribution;
  unchanged 100-item visible pages, 25-session and five-related-item previews.
- Complete SQL annotation HEAD counts for **10,037 annotations** under all caps,
  plus invalid/missing count and database failure rejection.
- Task 16 tests run unchanged, including its dated/null fences, live mutations,
  large session inputs, errors, daily stats, report totals and bounded previews.

The R5 facets/joins target is executable. The **Task 18 query-efficiency gate
remains TODO**. Synthetic evidence does not establish deployed caps, grants,
collation, query plans/performance, migration state or production behavior.

## Impact and rollback

Changed runtime files: `complete-metadata-query.ts`, `articles-service.ts`,
`metrics-service.ts`, `sources-service.ts`, `tags-service.ts`, `daily-stats.ts`.
Changed/additional evidence: the capped fixture, metadata service/server tests,
Metrics fixture entities (now use the actual relation key), R5 regression,
this document and architecture documentation. Authors, metadata coverage and the
Task 16 session helper/regression files are unchanged.

No migration, schema/RPC/grant, dependency/lockfile, environment contract, cron,
authentication, interface, sync/quota/retry/lease/checkpoint or rollup definition
change. No historical data rewrite, enrichment/backfill, real Matter sync,
production SQL, deployment, token rotation or merge. Complete reads use more
bounded requests and memory as input grows; runtime/network failures reject
instead of certifying truncated results. Request reuse/aggregate efficiency
remains Task 18.

Rollback is a code revert of this focused change through the separately authorized
release procedure. There is no migration undo, data rewrite, environment change
or checkpoint reset. Reversion reintroduces truncation; roll-forward is preferred.
Existing sync migration/release restrictions remain applicable.

## Validation results

Final check results are recorded here and in the draft PR. Initial targeted
verification found a test-only expected offset of 600 after 501 returned rows;
corrected to 501, confirming actual-row advancement. A test fixture's inferred
nullable timestamp type was also corrected. Neither was a production defect.
Final grammar review also caught an overgeneralized fixture decoder and an
intermediate attempt to quote scalar equality values. Scalar calls were restored
to the baseline form; the fixture now distinguishes scalar versus logical/in
quoting, with a literal quote/backslash regression. The final full suite includes
that correction. The restricted shell cannot report Node test worker outcomes
reliably; the required suite ran with authorized command execution and synthetic
fixtures.

- **Passed:** `npm ci`; `npx --no-install next typegen` before typecheck;
  `npm run typecheck`; `npm run lint` (three preexisting Visual Explainer warnings);
  `npm run test` (**321 passed, 0 failed, 0 cancelled, 0 skipped, 1 TODO, 322 total**);
  `npm run build`; `npm run audit:ci`; `git diff --check`. Audit reports **0
  production vulnerabilities**; seven full-audit high finding entries fall under
  the unchanged development-only `GHSA-vfj7-8cjw-p6xm` exception.
- **Failed:** none on final checks. Corrected intermediate failures/grammar issues
  are described above and are not final acceptance evidence.
- **Blocked:** none for required local validation. Deployed behavior remains
  unverified; it is not inferred from synthetic success.
- **Skipped:** disposable fresh/upgrade database validation (no schema/RPC/grants
  changed; opt-in acknowledgement not set). Production operations prohibited by
  the task were not run.
- **TODO:** Task 18 request reuse/aggregate efficiency; external deployed Data API,
  authorization, caps, query plans and consistency/performance during live writes.
