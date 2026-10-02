# Matter API v1 contract and capability matrix

**Reviewed:** 2026-09-29 from the official documentation links below. Documentation network access from this execution environment returned an authorization error, so the supplied 2026-09-29 review is recorded here and is **not** claimed as a fresh live/API verification.

Base URL: `https://api.getmatter.com/public/v1/`. Authentication is a server-side Bearer token for Matter Pro. The account has one active Matter token; generating another immediately invalidates the previous token. Unknown response fields are ignored while required fields are validated.

| Endpoint | Documented | Application use |
|---|---|---|
| `GET /reading_sessions` | `id`, UTC `date`, `seconds_read`, discriminator `object`; inclusive `since`, `limit`, `cursor`; date-descending | Time, sessions, active days and streaks |
| `GET /items` | `updated_since`, `status`, `order`, `limit`, `cursor` | Full library bootstrap and incremental metadata |
| `GET /items/{id}` | Metadata, progress, nullable estimated `word_count`; optional `include=markdown` | Library detail, never measured session time |
| `GET /items/{id}/annotations` | Per-item `limit`/`cursor` | Optional highlights/notes; no `updated_since` assumption |
| `GET /tags` | `limit`/`cursor` | Tag catalogue; no `updated_since` assumption |

The common page envelope is `results`, `has_more`, `next_cursor`; limit is 1–100 and defaults to 25. Rate limits supplied by the plan are 120 GET/minute and 5 requests/second; markdown is 20/minute and also consumes GET quota. Clients must honor valid rate-limit and retry headers.

## Session adapter

`id → external_session_id` (currently stored as `reading_sessions.id`), `date → occurred_at` (currently the legacy `started_at` column), and `seconds_read → duration_seconds`. UTC is preserved. `object` is a discriminator, not an item ID. No factual `ended_at` is invented.

## Capability classification

| Classification | Capability |
|---|---|
| Documented | Session identity/date/duration; item/library metadata; endpoint-specific pagination; annotations and tags |
| Observed only / legacy | Historical payloads may contain item-like shapes or alternate timestamp aliases; preserve raw legacy links but do not promote them to a guarantee |
| Application policy | Legacy `started_at` aliases occurrence; nullable `item_id`; fixed WPM estimates; future 7-day overlap; endpoint validation and sanitization |
| Unavailable | Documented session→item identity, factual start/end interval, measured word delta, session `updated_since`/`until`/`order`, retention/cursor TTL/late-update bound, deletion feeds, dated completion events |

Missing item linkage is expected, must not trigger enrichment retries, and does not remove valid reading duration. Runtime attribution requires documented provenance. Archive, extraction completion and current progress are not a dated reading-completion event.

Official sources: [overview](https://docs.getmatter.com/api), [sessions](https://docs.getmatter.com/api/reading-sessions/list), [items](https://docs.getmatter.com/api/items/list), [item detail](https://docs.getmatter.com/api/items/get), [item update](https://docs.getmatter.com/api/items/update), [pagination](https://docs.getmatter.com/api/pagination), [rate limits](https://docs.getmatter.com/api/rate-limits), [authentication](https://docs.getmatter.com/api/authentication), [errors](https://docs.getmatter.com/api/errors), [versioning](https://docs.getmatter.com/api/versioning), [annotations](https://docs.getmatter.com/api/annotations/list), [tags](https://docs.getmatter.com/api/tags/list).
