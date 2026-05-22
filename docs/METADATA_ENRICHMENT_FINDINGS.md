# Matter Stats: Reading Session Metadata Enrichment Findings

_Date: 2026-05-19_

## Scope and constraints

This investigation focused on safe metadata enrichment paths for `reading_sessions` without changing current production sync behavior, without reintroducing full-library-first sync, and without adding migrations yet.

## Current state in this repo

- Reading sessions are imported from Matter `/reading_sessions` using `since`, `limit`, and `cursor`. The code currently assumes optional item linkage fields, but tolerates missing linkage.  
- Session item-link extraction checks many possible fields (`item_id`, `itemId`, `object`, `library_item_id`, `target_id`, embedded `item`/`target`, etc.).  
- `object` is only treated as an item ID if it starts with `itm_`; observed payloads with `object: "reading_session"` therefore yield `item_id = null` (as expected).  
- Recent-activity item sync already exists and calls `/items` with `updated_since`, `status=all`, and pagination, which is full-library-safe when bounded to a recent window.

## External Matter API findings (docs review)

Based on Matter's current public docs and CLI reference:

1. **Reading sessions linkage**
   - Public docs list only a **List Reading Sessions** endpoint (no documented get-by-id session endpoint).
   - There is no documented `expand`/`include` parameter for reading sessions.
   - The endpoint is documented as paginated with cursor semantics; in-repo integration already uses `since` + pagination.

2. **Items endpoint filtering supports incremental strategies**
   - Items list supports `status`, `order`, `updated_since`, `limit`, and `cursor`.
   - `updated_since` provides an official incremental fetch lever that avoids full-library sync.

3. **No first-class documented "item activity timeline" endpoint**
   - Current docs/CLI references expose items, reading sessions, annotations, tags, search, account.
   - No separate documented activity/history endpoint that directly maps session timestamps to item IDs.

4. **Annotations are item-linked but incomplete bridge**
   - Annotations are fetched per item (`/items/{id}/annotations`), so they can enrich only items already known.
   - Useful for partial attribution, but cannot reliably map all sessions (many sessions have no highlights).

## Answers to research questions

1. **Does the Matter API expose a session→item link?**  
   **Partially/conditionally.** The app code already handles potential fields (`item_id`, embedded `item`, etc.), but observed real payloads currently do not provide an item ID in your environment.

2. **Does `/reading_sessions` support expand/include/filters/detail endpoint?**  
   **Documented support:** pagination + incremental `since` behavior.  
   **Not documented:** expand/include/detail (`/reading_sessions/{id}`) fields.

3. **Item activity / reading history join by timestamp?**  
   **No dedicated documented endpoint found.**

4. **Can recently read items be fetched without full library?**  
   **Yes, indirectly** via `/items?updated_since=...` plus bounded windows.

5. **Can items be queried by recently read/updated/archive/read status?**  
   **Updated:** yes (`updated_since`).  
   **Status:** yes (`status=inbox|queue|archive|all`).  
   **"Recently read" explicit filter:** not documented.

6. **Can highlights/annotations bridge metadata?**  
   **Partially yes**, but coverage will be sparse and biased to highlighted content.

7. **Safe recent-items-only strategy?**  
   **Yes.** A bounded recent-item sync (e.g., rolling 30/90/365-day `updated_since`) is feasible and avoids full-library-first.

## Recommended next implementation option (no production behavior change in this task)

**Recommended option: "recent-item enrichment pass" (feature-flagged, additive).**

- Keep current session ingestion unchanged.
- Add a non-default enrichment job that:
  1. Selects sessions with `item_id is null` in a bounded date range (start with current year).
  2. Fetches recent items via `/items?updated_since=<window_start>&status=all&order=updated` with pagination caps.
  3. Builds a local candidate map by day/time buckets (session timestamp vs item `updated_at_matter`) and optional heuristics (source/device/day density).
  4. Writes only **high-confidence** matches to `reading_sessions.item_id`; leaves ambiguous rows null.
  5. Records diagnostics (matched/ambiguous/unmatched) in sync run metadata/logging.

Why this first:
- Uses only documented, stable API surfaces already integrated.
- Scales for 25k–30k libraries because it bounds by recent windows and pagination budgets.
- Preserves safety by avoiding speculative low-confidence writes.

## Risks and limitations

- **No deterministic join key** in observed session payloads means timestamp matching is probabilistic.
- Item `updated_at` may reflect non-reading events (tag edits, favorites, extraction updates), creating false positives.
- High-volume readers may have many candidate items per day/time window.
- Annotation-based fallback has low recall for non-highlighting sessions.
- Rate limits can constrain enrichment throughput; batching and checkpointing remain required.

## Schema sufficiency assessment

**Current schema is sufficient for initial enrichment iteration.**

Why:
- `reading_sessions.item_id` is already nullable and can be backfilled later.
- Existing item/session tables and indexes support incremental matching queries.
- Existing sync run diagnostics columns already capture missing-link counts.

## Likely future migration needs (not now)

A migration is **likely later** if you want durable provenance/auditability for inferred links. Potential additions:
- `reading_sessions.item_match_confidence` (numeric)
- `reading_sessions.item_match_strategy` (text enum-like)
- `reading_sessions.item_matched_at` (timestamp)
- Optional side table for candidate matches / review workflow

These are not required to begin a conservative enrichment proof-of-concept.

## Bottom line

Given currently observed Matter session payloads and documented API capabilities, the safest path is:
1) keep ingestion as-is, 2) add a bounded recent-item enrichment pass behind a flag, 3) write only high-confidence matches, and 4) defer schema expansion until confidence/provenance requirements are validated.
