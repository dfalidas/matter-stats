# Architecture and application contract

This documentation refresh inspected implementation baseline `6648b5d240719998ac0fd0fe29c47e28d224a496`; the local baseline exactly matched the reviewed commit, so there were no later application commits to reconcile. This document describes the resulting repository contract, not proof that a production database or deployment matches it.

## System shape

Matter Stats is a private, single-user reading analytics application:

- **Web application:** Next.js App Router and React, written in TypeScript and styled with Tailwind CSS.
- **Hosting contract:** Vercel runs dynamic server components, server actions, middleware, and the scheduled route. `vercel.json` schedules recent-activity sync at `0 6 * * *` UTC each day.
- **Persistence:** server-side Supabase JS calls the Supabase Data API with `SUPABASE_URL` and the service-role key. The browser has no Supabase client or key.
- **Upstream data:** server-side sync code calls Matter with `MATTER_API_TOKEN`, normalizes library metadata and reading sessions, and writes them through Supabase.

`APP_ACCESS_PASSWORD`, `MATTER_API_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` are secrets. `SUPABASE_URL`, `APP_CREDENTIAL_VERSION`, `APP_TIMEZONE`, and the sync limits are also server-side configuration in this application. None should use a `NEXT_PUBLIC_` prefix.

## Authentication and authorization

Login compares the submitted shared password in constant time, then calls `public.record_app_login_attempt` through the service role. A successful login creates a random opaque token. Only its SHA-256 hash, credential version, creation time, expiry, and revocation state are stored in `public.app_sessions`; the raw token is placed in the HTTP-only, same-site `matter_stats_session` cookie. Sessions have a 30-day server-side expiry and can be revoked at logout. Raising `APP_CREDENTIAL_VERSION` invalidates sessions created under older versions.

Login fails closed when the limiter RPC, session table, Data API, or network is unavailable: the form receives a generic retryable message and no session cookie or dashboard redirect. Server diagnostics are limited to allowlisted operation and reason identifiers rather than raw database errors or request credentials. Incorrect-password and rate-limit messages remain distinct. Session validation likewise denies access when storage returns an error or rejects its operation.

Authorization has two layers:

1. `middleware.ts` permits `/login`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, `/icon.svg`, Next.js assets, and `/api/cron/*` without the app session. For other paths it validates the database-backed session and redirects failures to `/login`. This is an early user-experience redirect.
2. Protected server pages call `requireAccessSession`, and protected dashboard server actions independently validate the session before accessing data or syncing. These page/action checks are the mandatory authorization boundary; middleware alone is not sufficient.

The cron route is intentionally outside cookie authentication. `GET /api/cron/sync-recent-activity` accepts only an exact `Authorization: Bearer <CRON_SECRET>` value. It does not accept a query parameter. It performs the bounded recent-activity sync and honors the stored Matter rate-limit state; it does not promise a full library backfill or reliable continuation across every invocation.

## Routes and navigation

The current primary navigation is **Overview** (`/dashboard`), **Activity** (`/activity`), **Library** (`/articles`), and **Reports** (`/reports`). Desktop navigation also links Settings and Log out. On mobile, Settings and Log out are in the **Account** menu while the four primary destinations remain in the bottom navigation.

### Analytics comparison windows

Reports use complete local calendar periods and compare them with the immediately preceding period of the same identity: day, Monday-based week, month, or year. Historical reports are never clipped to the current clock. Overview presets are period-to-date: one request-scoped `now` closes the current window, and the comparison closes at the same local calendar position and wall-clock time in the preceding day, week, month, or year. Custom Overview dates remain complete inclusive user dates (represented by an exclusive midnight boundary) and compare with the immediately preceding equal-length local-calendar span. All-time has no comparison.

Month/year comparisons clamp a missing corresponding day to the target month's last valid day while retaining the local clock time; they never overflow into the next month or beyond that period's exclusive end. Local times in a daylight-saving gap advance by the transition gap, while repeated local times select the earlier instant. These deterministic rules match JavaScript/Temporal `compatible` disambiguation. Every query uses half-open bounds (`start <= started_at < end`), and heatmaps include an ending calendar day when the exclusive end is intraday but exclude that day when the end is local midnight.

An Overview request made exactly at the local start of its selected preset has an empty period-to-date window: its heatmap has no day buckets and its range copy displays that boundary as an `As of` date rather than an inverted range.

Other implemented routes are:

- `/` redirects to `/dashboard`; `/login` is the public password form.
- `/articles/[id]` shows a library item.
- `/settings` provides sync/data diagnostics.
- `/sources`, `/authors`, `/tags`, and `/year-in-reading` are retained legacy analytics routes even though they are not in primary navigation.

All application/data routes above except `/login` require an app session.

## Environment contract

| Variable | Required by current code | Meaning |
| --- | --- | --- |
| `APP_ACCESS_PASSWORD` | Yes | Shared login password; server-only secret. |
| `APP_CREDENTIAL_VERSION` | Operationally required; code defaults to `1` | Positive integer stored with sessions. Increment after password rotation to revoke older sessions. |
| `APP_TIMEZONE` | Optional | IANA timezone for analytics; invalid/missing values fall back to `Europe/Athens`. |
| `MATTER_API_TOKEN` | Yes for Matter operations | Server-only Matter API secret. |
| `SUPABASE_URL` | Yes | Server-side Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only administrative key; can bypass RLS. |
| `CRON_SECRET` | Required for scheduled sync | Server-only Bearer secret; a missing value makes cron authorization fail closed. |
| `MATTER_SYNC_ITEMS_LIMIT` | Optional | Positive per-request item page limit; defaults to `25`. |
| `MATTER_SYNC_SESSIONS_LIMIT` | Optional | Positive per-request session page limit; defaults to `25`. |

## Matter sync stream cycles

Matter pagination is persisted independently in `public.matter_sync_streams` for `recent_sessions` (`GET /reading_sessions`) and `library_items` (`GET /items`). Manual and scheduled activity syncs are only different triggers for the same `recent_sessions` stream. Each active cycle pins its endpoint, exact documented filters/lower bound, page limit, opaque cursor, start time, and cycle generation; later invocations resume that contract even across a year boundary or environment limit change. Cycle generation identifies a logical cycle and is not the Task 12 lease/fencing generation.

Matter cooldowns are account-wide: availability checks and every sync invocation use the latest active retry timestamp across both streams and the retained legacy singleton before any cycle write or upstream call. An explicit manual history-window selection is also durable. Repeating that same selection resumes the pinned contract without recomputing its rolling boundary; requesting a different window is rejected without changing state or calling Matter. Scheduled triggers do not change the stored history intent.

The first sessions cycle uses the explicitly selected coverage lower bound. A genuinely exhausted cycle promotes its captured start time to the completed watermark, including when the final page is empty. Partial and failed cycles do not promote it. Later cycles replay from seven days before that watermark using inclusive `since`; this is an application overlap policy for idempotent upserts, not a Matter late-arrival or cursor-snapshot guarantee. Imported minimum/maximum timestamps do not establish historical completeness. Library enumeration uses only documented parameters and remains independent of session import.

The legacy singleton did not persist its page limit, so a complete active request contract cannot be reconstructed. Migration creates both streams with a `legacy_recoverable_restart` marker, no cursor, and no claimed completed watermark. Existing imported domain rows are preserved.

## Account lease and fencing (Task 12 / E2 / W4 / R4)

All three triggers acquire the same `matter` account scope in
`public.matter_sync_leases`, before reading/resuming a cycle, creating a run or
calling Matter. The scope is a fixed single-account identifier, never the API
token. Every invocation generates a UUID owner. An occupied, unexpired lease
returns a controlled `busy` result with no upstream requests or protected writes;
cron returns HTTP 200 with `status=skipped` and `skipped_reason=busy`. Active
account cooldowns similarly skip inside the leased runtime without creating a
run. Authentication remains before invocation: the manual action validates its
app session and cron validates its Bearer secret before any lease operation.

The durable row stores `owner`, `expires_at` and BIGINT `generation`. Acquisition
locks that row and samples `clock_timestamp()` **after** lock acquisition. Only
release/expiry permits a new owner; every acquisition increments generation.
Renewal keeps generation and requires matching scope, owner and generation plus
an unexpired lease. Release applies that same comparison, clears owner/expiry,
and retains generation. An expired owner cannot revive or release the lease.
`service_role` has SELECT/UPDATE but no INSERT/DELETE/TRUNCATE on this table, so
it cannot delete/recreate the durable row. Administrative direct writes are a
trusted boundary, not a lease-aware interface. Application contexts carry the
BIGINT as decimal text to avoid JavaScript integer precision loss. Stream
`cycle_generation` continues to identify cycles independently.

The runtime TTL is **120 seconds**, with SQL input validation of **30–300
seconds**, including explicit rejection of NULL. There is no new configuration
variable. Renewal occurs before and after account/page/item/annotation requests,
after Matter pacing and immediately before each actual HTTP fetch, before each
100-row mutation batch, before each rollup calculation and each rollup batch.
Annotation pagination has a guarded request for every page. Renewal failure or
infrastructure failure stops the invocation; a response arriving after expiry
cannot be imported. No background timer is required: a request taking longer
than the TTL causes the invocation to stop at its response boundary. Catch and
finally continue to use the original owner/generation; they cannot mutate state
or release a successor's lease. Process crashes recover through expiry. A lost
lease can leave its run marked `running`; reconciling abandoned run records is
not implemented here.

Each production mutation below is one fixed-purpose RPC. Every RPC first calls
`assert_matter_sync_lease`, which locks the singleton with `FOR UPDATE`, validates
ownership/expiry, and retains the lock until the **same transaction containing
the mutation** ends. Acquisition/renewal/release use that same row. A mutation
validated before expiry may finish while holding the lock; takeover must wait
for it to commit. A worker that checked ownership earlier in application code
still must pass this transactional validation for its actual write. There are
no SQL transactions, row locks or advisory locks across Matter requests.

| Actual mutation path | Fenced database operation |
| --- | --- |
| Stream start/resume, cursor, cycle completion, watermark, coverage intent and catch-path cooldown | `sync_upsert_stream` |
| Linked-item placeholders, fetched/embedded enrichment and library items | `sync_upsert_matter_items` |
| Reading-session import | `sync_upsert_reading_sessions` |
| Tags and annotations, including optional enrichment | `sync_upsert_matter_tags`, `sync_upsert_annotations` |
| Item-tag removal/replacement | `sync_replace_item_tags` (both statements in its own transaction, max 100 item IDs) |
| Recalculation and date-range helper's rollup batches | `sync_upsert_daily_stats` |
| Run creation, successful completion and error/cancellation catch paths | `sync_create_run`, `sync_update_run` |

Run IDs equal invocation UUIDs; run patches require `p_id=p_owner`, without
rewriting old runs or adding metadata columns to them. The cron wrapper performs
no independent database writes. The legacy `sync_state` remains read-only for
cooldown compatibility; unused unfenced sync-state/item-tag mutation exports were
removed. Missing/invalid lease contexts are rejected before client operations.
There is no ordinary table mutation fallback when an RPC is missing or fails.
The SQL operations name fixed relations/columns and use typed record conversion;
there is no arbitrary table-name or SQL mutation API. Batches are bounded to 100
rows, except tag replacement's bounded 10,000 links across at most 100 items.

All 14 new functions, including `assert_matter_sync_lease` and
`validate_matter_sync_batch`, are SECURITY INVOKER with empty `search_path` and
qualified relation/function references. Exact signature grants revoke PUBLIC,
`anon` and `authenticated` execution and allow only `service_role`. The new
exposed-schema table has RLS enabled and browser/PUBLIC access revoked. See the
catalog inventory in `scripts/matter-sync-lease-inventory.mjs` and the release
runbook for real permission-denial evidence requirements.

**Task 12 boundary (superseded by Task 13 below):** fencing protected each
existing mutation transaction, not an entire page. Items, tags, annotations, sessions, rollups, stream state and run
status still commit separately. Earlier committed work may remain after failure;
retries resume/replay the durable cycle. Task 13 implements an entire page
plus checkpoint and dirty-rollup marker atomically. Tasks 14–15 retain the
continuation/backfill/shared-quota work. No new queue, scheduler, historical
repair, multi-tenant model or metric change is introduced.

## Database and release order

Apply every file in `supabase/migrations` in timestamp order. The login schema specifically requires:

1. `20260929000000_harden_rls_and_auth.sql` creates `public.app_sessions` and `public.app_login_attempts`, enables RLS on the application table inventory, removes browser-role table access, and grants the service role.
2. `20260929010000_atomic_login_limiter.sql` creates the function `public.record_app_login_attempt(p_client_key_hash text, p_succeeded boolean, p_limit integer default 5, p_window_seconds integer default 900) returns boolean`, revokes browser-role execution, and grants execution to `service_role`.
3. Only after both migrations succeed should application code that calls that RPC be deployed.
4. `20261004000000_add_independent_sync_stream_cycles.sql` adds the protected stream-cycle rows and must precede Task 11 runtime code.
5. `20261004010000_preserve_sync_cooldown_and_window.sql` preserves the legacy account cooldown and adds explicit session-window intent; it must also precede Task 11 runtime code.
6. `20261005000000_matter_account_lease_fencing.sql` adds the singleton lease and its 14 invoker RPCs/helpers; it must precede Task 12 runtime. Disable and drain all old unfenced writers before enabling the new runtime; an additive migration alone cannot fence old ordinary table writes.

The SQL expresses the intended RLS and grant policy, and the TypeScript implements service-role-only access. That is not evidence that production has applied the migrations. Fresh and upgrade migration runs, Data API denial for `anon`/`authenticated`, service-role allowance, and the RPC's behavior under real concurrent database calls must be verified separately in an isolated Supabase environment. Unit-test mocks do not establish those properties.

## Metrics and known boundaries

- Estimated words use the fixed formula `Math.round(duration_seconds / 60 * 225)` for each valid session. Totals sum those integer session estimates; they never round a day, item, group, or period's combined duration.
- `matter_items.word_count` is nullable upstream metadata, not a measured reading total. Item reading-time metadata is derived from it when present.
- Session normalization and normal future writes persist the duration-based estimate. Production reads independently derive the same value from session duration, so missing or bogus legacy `words_estimated`, item word counts, progress, and missing item links do not change analytics.
- Existing historical `reading_sessions.words_estimated` and `daily_stats.words_read` rows may remain stale until the repair/rebuild work in Tasks 19–20. This change does not backfill or rewrite them; normal future session and daily-rollup writes are canonical, and current application reporting calculates from sessions.
- Matter session payloads may lack a usable item identifier. Those sessions can be stored with a null `item_id`, so time/session totals can remain available while source, author, tag, article counts, and other attribution-dependent breakdowns are incomplete. Missing attribution is an unsupported capability with the observed payload—not a promise that another sync will repair it.
- Analytics calendar behavior uses the validated `APP_TIMEZONE`, defaulting to `Europe/Athens`. Raw timestamps stay UTC; session, annotation, activity, report, and new daily-rollup windows use local calendar boundaries converted to UTC with half-open `[start, end)` queries. Reading sessions are attributed wholly to their start date. Current reading streaks are anchored to one request-scoped current time and may carry through an empty today only when yesterday is active; reports expose their selected-date streak separately.
- Legacy `daily_stats` rows may still reflect the former UTC-day buckets until the authorized repair/rebuild work in Tasks 19–20. Latest-week discovery therefore uses raw reading-session timestamps rather than treating those historical rollups as authoritative. This release does not recalculate, backfill, or otherwise repair production history.

## Remaining stabilization work

The merged interface redesign does not complete the stabilization plan. Remaining work includes:

- review official advisories and apply the smallest supported security dependency patches;
- reliable sync continuation and large-history behavior; Task 12 ownership requires isolated SQL/Data API verification before release;
- complete/paginated database queries rather than implicit Data API result limits;
- historical timezone rollup repair and reconciliation;
- repair/rebuild tooling for derived data and interrupted sync state; and
- CI coverage, including isolated database authorization and migration checks.

## Verification boundaries

Repository inspection can confirm code, migration text, and deterministic local checks. It cannot by itself confirm the deployed commit, environment values, migration history, production RLS/grants, Supabase Security Advisor state, live Matter response shapes, actual RPC concurrency, cron delivery, or stored-data correctness. Record those as external verification evidence rather than marking them complete from implementation alone.

## Atomic pages and durable rollup recovery (Task 13)

The Task 13 runtime prepares a complete normalized mutation plan before page
persistence. It validates the list envelope and continuation before enrichment;
optional item 403/404/429 and annotation 403/404 retain their existing behavior
with operation/status diagnostics. Invalid sessions and unlinked annotations are
skipped with reason identifiers. Required placeholders are insert-only, so a
missing optional item cannot erase previously imported metadata. Embedded items,
tags, complete item-tag replacements and accepted annotations are included.
Preparation performs no database mutations. Network calls and daily calculations
remain outside SQL transactions.

`commit_matter_page` is the only page persistence RPC. It locks/asserts the Task
12 owner, generation and database expiry, then locks the selected stream and
compares its cycle generation, endpoint, filters, page limit, cursor, fixed start,
watermark, coverage and transition status. These two generations remain distinct.
All normalized rows and joins, dirty dates, checkpoint/completion and receipt
commit in that transaction. Empty terminal pages complete it; only validated
exhaustion promotes the fixed cycle start. Other streams and stored cooldowns
are preserved. The older fenced row RPCs are called internally in this same
transaction; they are no longer separate client page requests. Run creation,
logging, cycle start/resume and cooldown writes still use Task 12 fencing.

The SQL derives old and new session/annotation local dates before replacing rows.
Changes in item source/status/progress dirty existing session dates because those
fields affect daily metrics. Dates use the validated APP_TIMEZONE; raw IDs,
durations and UTC timestamps retain the existing normalization/metric contract.
Unchanged normalized rows do not replace pending marker revisions. Placeholders
never update existing rows.

Bounds are explicit: 100 page sessions/items/placeholders/replacement item IDs;
10,000 tags, links and annotations; 4 MiB serialized page/normalized plan; 4,096
cursor characters; 100 annotation requests and 10,000 raw annotation rows across
one page's enrichment. Metadata effects examine at most 10,001 matching session
rows and reject when more than 10,000 require dirty work. SQL accepts only known
row fields, streams and operations. Exceeding any bound rejects the whole page;
there is no truncation or checkpoint advancement to hide omitted work.

`matter_page_receipts` retains only the latest receipt per stream (at most two
rows). A page request has one UUID and a database fingerprint of its immutable
preceding receipt/contract/plan/transition/timezone. An identical retry under a valid lease returns
the durable stream without writes; a changed payload with that UUID is rejected.
After a newer receipt replaces it, an old request must pass the current stream
comparison and therefore cannot rewind a cursor or overwrite a newer cycle.
The client retries uncertain transport outcomes once with the exact same request.
If the process stops or uncertainty remains, the next invocation resumes from
the durable stream, never an assumed client checkpoint.

`matter_dirty_rollups` stores one pending row per local date, its timezone and a
fresh database UUID revision for each page commit. That revision is independent
of the lease generation and distinguishes successive pages under the same lease.
Every invocation first recovers up to 32 dates under its lease, even during an
upstream cooldown. After a page commits it processes another bounded snapshot.
For each marker, calculation uses its recorded timezone outside SQL;
`ack_matter_rollup` atomically fences, locks/compares that exact revision/timezone,
writes daily_stats and deletes only that marker. A stale acknowledgement returns
false without even writing an older rollup. Calculation/write/interruption/lease
loss retains pending work. Work beyond each bound remains durable. Page checkpoint
durability is independent of rollup success; run status may report an error even
when the page itself committed.

The two new RLS tables and four invoker RPCs/helpers use object-scoped service-role
grants, no PUBLIC/browser privileges and empty search_path with qualified objects.
Catalog and Data API inventories are in `scripts/matter-page-inventory.mjs` and
the disposable gate. See [task-13-validation.md](task-13-validation.md) for actual
evidence and [deployment.md](deployment.md#task-13-release-order-and-rollback)
for migration-before-code and old-writer handling. This supersedes Task 12's
separate-page-transaction boundary; it does not certify analytics completeness,
add continuation/backfill, or repair historical data.

Replay also compares the receipt that preceded preparation, so an old page cannot
be accepted if an opaque cursor value recurs within the same cycle. The latest
receipt remains bounded; a reused-cursor SQL regression verifies this guard.
Permanent stale-contract conflicts return `PT409`; they do not use SQLSTATE
`40001`, which can cause PostgREST to retry a deliberately rejected transaction.

## Task 14 bounded continuation and explicit history

Task 14 replaces the one-page invocation boundary with sequential bounded page
commits. All triggers still acquire one account lease; the scheduler never calls
another leased worker. Each next page uses the returned durable stream contract
and a freshly read preceding receipt. Exhaustion follows validated `has_more`,
including empty terminal pages. Partial work does not advance a watermark.

`matter_sync_continuation` is one service-only/RLS singleton. An authenticated
**Start / Resume Session History** (or explicit **All available sessions**)
request records an idempotent `all` intent. A currently active narrower session
cycle finishes under its original contract before full history starts. The fenced
start binds a new generation to `/reading_sessions`, empty filters (no `since`),
a fixed page limit and captured start, preserving its prior completed watermark,
raw rows, receipts, dirty work and lease generations. The completion trigger runs
inside the Task 13 page transaction and records exhaustion of this enumeration.
Matching completed requests remain complete; they do not silently re-import or
restart. Lower-bound/custom history coverage is not offered; the RPC rejects any
coverage other than `all`. Later incremental cycles retain seven-day overlap.

Every invocation shares an AsyncLocalStorage budget: **8 committed pages, 224
Matter HTTP attempts, 90 seconds upstream preparation, 150 seconds total**.
`/me`, linked-item reads, all annotation pages and failed HTTP attempts count.
Each HTTP attempt, response body and lease check is cancellable at 10 seconds or
the remaining preparation deadline. Existing 250 ms pacing remains; sync adds no
upstream retries. Before later pages, admission reserves `limit + 101` attempts
(the maximum list + linked items + 100 annotation pages); a deferred expensive
page gets a fresh invocation. The maximum valid Task 13 page requires 201
preparation attempts, plus `/me`, below the fresh 224-attempt ceiling. A request
or time stop discards the entire uncommitted plan. Sustained upstream slowness,
cooldowns or errors can still delay completion; no finite invocation promises
that an unavailable/slow upstream will finish. This is not Task 15's shared quota
limiter, and Matter can return 429 before an invocation budget is consumed.

Database HTTP is bounded to 10 seconds and the remaining total deadline. Rollup
recovery retains two snapshots of at most 32 markers and checks remaining time
before each marker; it stops admission with 60 seconds remaining for one marker
(renew, parallel reads, acknowledgement) and progress read/logging/release, each
database step capped at 10 seconds. Exact-revision acknowledgement remains atomic. Commits,
logging/release and recovery have a 60-second application margin after upstream
preparation, plus 30 seconds below the explicit 180-second function cap. Deploy
on the documented Node.js/Fluid Compute runtime (300-second default); verify the
platform honors the 180-second route/page/server-action duration. This is bounded
execution, not an unlimited duration increase.

The unchanged daily **06:00 UTC** cron resumes active sessions, explicitly
requested history and active library work. It never creates a full-history intent
or starts an unrequested library backfill. A durable next-stream turn alternates
eligible streams before requests, so failed/expensive sessions do not keep library
work behind freshly started recent cycles. Each finished stream stops for this
invocation, except a queued history intent may begin after its narrow predecessor.
A browser is unnecessary; optional manual resumes only accelerate the same work.
Remaining chunks may wait until the next daily scheduled invocation (or longer
while busy, rate-limited or failing). Cron/manual responses expose partial status,
page/attempt counts and history status without claiming analytics completeness.

429s in `/me`, item or annotation preparation stop the page and persist an
account cooldown through a fenced RPC updating current durable rows.
The additive cooldown follow-up explicitly selects both account streams, retaining
Supabase safeupdate protection and the same signature/lease fence. Previously
accepted annotation pages are never committed as a subset after a later optional
endpoint failure. Lost SQL responses retain exact receipt replay; cooldown writes
cannot rewind a cursor. Authentication, raw UTC values, `APP_TIMEZONE`, per-session
metric formulas and bounded Task 13 SQL transactions remain unchanged. Imported
history is not an analytics cap fix or historical recompute/cutover (Tasks 16–20).
