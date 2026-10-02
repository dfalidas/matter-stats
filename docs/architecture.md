# Matter Stats architecture

## System overview

Matter Stats is a private, single-user analytics application built with Next.js 15 App Router, React 19, TypeScript, and Tailwind. Vercel is the intended runtime, Matter is the upstream data source, and Supabase/Postgres is the persistent store.

```text
Browser
  | password cookie / server actions
  v
Next.js App Router (app/, middleware.ts)
  |                         |
  | feature queries         | manual or scheduled sync
  v                         v
lib/*-service.ts       lib/matter-sync.ts
  |                         |-- lib/matter-api.ts --> Matter public API
  |                         |-- lib/matter-normalizers.ts
  +-------------------------+-- lib/supabase-admin.ts --> Supabase/Postgres
                                      |
                                      +-- matter_items, reading_sessions,
                                          annotations, tags, daily_stats,
                                          sync_state, sync_runs
```

### Application and security boundary

- `middleware.ts` redirects app pages to `/login` unless the signed `matter_stats_access` HTTP-only cookie is valid. API routes are excluded from this middleware, so every API endpoint must implement its own authentication.
- Pages in `app/` use server components for privileged reads. Client components provide navigation, filtering, charts, and forms without receiving Supabase service credentials.
- `lib/env.ts` lazily validates required server variables. `lib/supabase-admin.ts` creates a non-persisting service-role client used by server-side pages, services, actions, and sync code.
- `/api/cron/sync-recent-activity` is independently protected with an exact `Authorization: Bearer <CRON_SECRET>` check.

### Code map

| Area | Responsibility |
| --- | --- |
| `app/` | Routes, dynamic server-rendered pages, server actions, loading UI, and the cron route. |
| `components/` | Shared dashboard and UI primitives. |
| `lib/matter-api.ts` | Matter HTTP client, endpoint wrappers, request pacing, pagination, retries/rate-limit errors, and sanitized logging. |
| `lib/matter-normalizers.ts` | Converts variable Matter payload shapes into typed database rows. |
| `lib/matter-sync.ts` | Orchestrates one resumable import batch and daily-rollup recalculation. |
| `lib/matter-sync-progress.ts` | Pure sync modes, windows, cursor/rate-limit state, limits, and user messages. |
| `lib/supabase-admin.ts` | Privileged database client and upsert/sync-state operations. |
| `lib/*-service.ts` | Read models and aggregations for dashboard, articles, sources, authors, tags, reports, and metadata coverage. |
| `supabase/migrations/` | Timestamp-ordered Postgres schema history. |
| `tests/` | Unit tests compiled by `tests/tsconfig.json` and run with Node's test runner. |

## Matter synchronization

There are two entry points:

1. The authenticated dashboard server action calls `syncMatterData` for a user-selected recent-activity window or a library backfill.
2. The Vercel cron route calls the same orchestrator in `recent_activity_scheduled` mode after validating `CRON_SECRET`. Scheduled sync imports recent activity only.

Each call intentionally processes at most one Matter page per active phase. The default page size is 25 (configurable downward/upward with the two sync-limit variables), and the UI can be invoked again while `hasMore` is true. This keeps serverless executions bounded and makes work resumable.

### Batch lifecycle

1. Load the singleton `sync_state` row and the legacy latest successful checkpoint. Stop early if a stored Matter rate-limit deadline is still active.
2. Insert a `sync_runs` audit row with `running` status, then validate the Matter token through the account endpoint before mutating Matter-derived data.
3. Build batch state from the selected mode, checkpoint, saved cursors, and requested activity window.
4. Execute the active phase:
   - Recent-activity modes begin with **sessions**.
   - Library backfill begins with **items** and finishes after its item cursor is exhausted.
   - The general incremental phase order is **items → tags → sessions → complete**.
5. Normalize records and upsert in batches of 100. Items, tags, annotations, sessions, and item/tag links use stable IDs/composite keys, so retries are idempotent. Session-linked item metadata is taken from embedded data or fetched individually; placeholder items protect foreign-key writes when necessary.
6. Track dates affected by new and replaced sessions, items, or annotations, then recalculate only those `daily_stats` rows.
7. On success, persist counts/diagnostics in `sync_runs`, save cursors and checkpoints in `sync_state`, and return whether more work remains. On failure, record a sanitized error and do not advance the checkpoint. HTTP 429 retry timing is stored so later manual and scheduled runs can avoid Matter until the deadline.

Reading-session responses do not always contain an article identifier. Such sessions are stored with `reading_sessions.item_id = null`; they contribute to time, words, session counts, streaks, and heatmaps, but cannot contribute to article/source/author/tag attribution. Malformed sessions missing an ID, valid date, or duration are skipped and counted in sync diagnostics.

### Persistence model

- `matter_items` holds article metadata and reading state.
- `reading_sessions` is the canonical activity fact table; its item relation is nullable.
- `matter_tags` and `item_tags` model tag membership; `annotations` stores highlights/notes.
- `daily_stats` is a selectively rebuilt daily rollup used by report discovery and summary views.
- `sync_state` holds the singleton Matter phase, cursors, checkpoints, mode, and rate-limit deadline.
- `sync_runs` is the operational audit trail with imported counts and response-shape/pagination diagnostics.

## Metrics and calculation rules

`lib/metrics-service.ts` calculates interactive metrics directly from `reading_sessions` plus joined item/tag metadata. Periods are today, Monday-based week, calendar month, calendar year, all-time, or a custom range. Bounds are half-open and converted using `APP_TIMEZONE`; an absent or invalid value falls back to `Europe/London`.

| Metric | Definition |
| --- | --- |
| Reading time | Sum of positive `duration_seconds` in the selected sessions. |
| Words read | Sum of positive session `words_estimated` values. |
| Articles read | Count of distinct non-null `item_id` values. Unlinked sessions are not articles. |
| Sessions | Number of selected session rows. |
| Average session | Reading time divided by session count, rounded to seconds. |
| Source/author/tag rankings | Session totals bucketed by linked metadata, ordered by time, then words, articles, and name. Missing links/metadata are excluded. |
| Recent reads | Sessions grouped by item (unlinked sessions remain separate), totals summed, newest start time first. |
| Heatmap | Session totals grouped by local calendar date; bounded periods include zero-value dates. |
| Current/best streak | Consecutive local dates with positive duration or words; current streak ends on the day immediately before the exclusive range end. |
| Comparison | Absolute and percentage deltas against the immediately preceding equivalent period; percentage is null when the previous value is zero and the current value is nonzero. |

`lib/daily-stats.ts` maintains a separate UTC-date rollup after sync:

- Reading time sums session durations; sessions and item counts are distinct when IDs exist.
- Words prefer `words_estimated`. If absent, a linked item uses `word_count × progress` once per item; otherwise duration is estimated at 225 words/minute.
- Items read are distinct linked items marked `archive`, `read`, `completed`, or progress `1`; when none qualify, distinct linked items are used.
- Highlights are annotations whose Matter creation timestamp falls on that UTC date.
- Top source is selected by reading seconds, then session count, then alphabetically for deterministic ties.

Because interactive metrics use session `words_estimated` while the daily rollup has fallback estimates, values from those two paths can differ when Matter does not supply per-session word counts. Any change to these semantics should update both tests and this document.

## Environment and operations

`.env.example` is the non-secret contract. Required runtime values are the app password, Matter token, Supabase URL, and Supabase service-role key. `CRON_SECRET` is required for scheduled sync. Page-size variables and `APP_TIMEZONE` are optional.

Local static checks and builds do not contact Matter or Supabase. Login, live pages, synchronization, imported-row validation, cron verification, and production smoke tests require access to the corresponding external services. Database migrations must be reviewed and applied in timestamp order through a controlled deployment; Codex tasks must never apply them to production.
