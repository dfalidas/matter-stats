# Task 25 — v2.1 baseline and data inventory

Review date: **2026-10-23, Europe/Athens**. Scope: inventory, requirements and operator preparation only. No Tasks 26–32 implementation or production mutation is included.

## Deliverables

- [Concrete backlog and dependency map](task-25-backlog.md).
- [Goals, monthly review and provisional mobile specification](task-25-product-spec.md).
- [Static synthetic wireframes](task25/mockups.html), with [desktop](task25/mockups-desktop.png) and [mobile](task25/mockups-mobile.png) previews.
- [Task 26 handoff and evidence checklist](task-26-handoff.md).
- [Reproducible read-only inventory queries](task25/inventory-read-only.sql).
- [Validation and limits](task-25-validation.md).

The approved Action Plan v2.1 was read from the existing private Craft project. Personal inventory values and operational state are recorded **only in that project's dated log**, not in this public repository. Synthetic wireframes are product proposals, not production evidence.

## Baseline and evidence ledger

Confidence labels throughout this handoff: **verified** = directly observed within the stated scope; **incomplete** = evidence exists but cannot support the full claim; **unknown** = no adequate evidence; **unsupported** = the documented source contract cannot supply the capability. These are not interchangeable with zero, idle or complete.

| Finding | Source / environment | Observation | Confidence and limit |
| --- | --- | --- | --- |
| Default branch is `main`, at `32f23cc8260acf9afd90087e28f9dde1993d7ed8`, merge of [PR #87](https://github.com/dfalidas/matter-stats/pull/87) | Git remote HEAD, fresh fetch, GitHub repository/PR metadata | 2026-10-23, Task 25 inspection | **verified**; matches the plan; no later main changes at inspection |
| No existing Task 25 branch/documents/PR were found | Remote branch enumeration, all PR titles and local tracked-file search; Craft tracker | Same inspection | **verified** within these surfaces; PR #25 is an unrelated old tags change |
| Baseline CI [39607559844](https://github.com/dfalidas/matter-stats/actions/runs/39607559844) completed successfully | GitHub Actions API, exact baseline SHA | 2026-10-23 | **verified**: `verify`, `Fresh and upgrade database verification`, `Isolated browser and Supabase verification`; post-merge artifacts/cleanup not independently re-reviewed here |
| Vercel Git status is success for the baseline | GitHub combined commit status | 2026-10-23; status updated 2026-10-21 13:24:22 UTC | **verified** status only; deployed SHA/configuration and runtime operation remain **unknown** |
| Inventory aggregate reads succeeded | Connected Supabase production SQL; read-only repeatable-read transactions, 15s statement bounds | 2026-10-23 13:36:00.900981, 13:36:30.447092 and 13:37:49.432850 UTC (16:36–16:37 Athens) | **verified** observations of stored data/status; exact personal findings retained privately |
| Full production migration-chain identity | Catalog inspection and attempted migration-history lookup | 2026-10-23 | **incomplete**: required inspected objects exist; `supabase_migrations.schema_migrations` was absent. Presence does not verify definitions, ACLs, migration order or deployed code |
| Complete Matter account history / historical library membership | Existing API contract and Task 21 coverage semantics | Repository inspected 2026-10-23 | **unknown** account coverage; **unsupported** reconstruction of past library membership from today's library alone |
| Deployed end-to-end correctness, hosted staging, backup/restore and two actual scheduled cycles | Craft open gates, Tasks 23–24 and release runbook | Re-read 2026-10-23 | **unknown / NOT RUN** here; user still owns v2.0 operational closure |

The three inventory transactions have distinct snapshots. They are not a common reconciliation snapshot, and observations can change during normal ingestion. No Matter API, cron route, sync action or application login was invoked. Existing database scheduled-trigger evidence is an observation, not certification of two scheduler deliveries.

## Inventory receipt and interpretation

The private log records each row below with source, production environment, exact observation time, confidence and consequences. Public SQL contains structure only; outputs must stay private. Reads return aggregates and bounded status projections, never records, raw cursors, owners, cached HTTP bodies or credentials.

| Inventory dimension | Authoritative read | Interpretation / acceptance limit |
| --- | --- | --- |
| Reading sessions, valid earliest/latest occurrence, null/nonfinite/future dates, invalid/zero durations, duplicate/blank IDs, estimate provenance | `reading_sessions` aggregates, queries A/C | Stored grain is one session ID. Zero-duration sessions are valid; date extent/count does not prove available-history exhaustion |
| Library, tags, annotations and available field/link coverage | `matter_items`, `matter_tags`, `item_tags`, `annotations`, queries A/C | Current metadata availability only; no historical membership guarantee. Nullable item `word_count` is article size, not words read |
| Independent sessions/library cycle, pinned scope, pending cursor, terminal observation, completed watermark | `matter_sync_streams`, latest `matter_page_receipts`, `matter_cycle_completions`, query B | `cycle_active` means durable pending work, not a live worker. A watermark is the cycle-start source boundary; Task 21 `completed_at` is terminal commit observation time |
| All-available-session intent | `matter_sync_continuation`, query B | Distinguish `none`, `pending`, `running`, `complete`. Constant `coverage='all'` alone is not an explicit request. Its legacy `completed_at` is a source boundary, not wall-clock completion time |
| Progress | Terminal observation, bounded `sync_runs`, record write timestamps, query B | Run counters count upserts, not necessarily newly imported unique rows. No dedicated per-page progress timestamp exists in receipts. Stream `updated_at` is a state-write proxy, not independently certified progress; exact last successful nonterminal page time can remain **incomplete** |
| Preparation, pending requests, exhausted/ambiguous retry chains, cooldown and lease | Three reduced `matter_request_work` slots, `read_matter_retry_status`, stream/legacy cooldown, lease expiry, query B | Preserved successful preparation is not committed ingestion. A deadline's expiry does not reset exhaustion or prove worker liveness; error flags are not diagnosis |
| Pending derived work and generation reconciliation | Dirty-date count and `read_matter_generation_status`, query B | Pin pointer/epoch/version evidence in the existing SQL snapshot. Candidate ready is not active. Legacy/no active canonical reconciliation is not a reason to hide successful raw metrics |
| Session-to-item/source/author/tag attribution | Semijoin/count projection, query A | Denominator is all stored sessions; no many-to-many expansion. A missing documented item identifier cannot be repaired by guessing or promised metadata sync |

No completeness percentage or completion date is derived. Inventory is not Task 27 reconciliation and does not authorize Task 28.

## Existing UI and documentation discrepancies

Code inspection covered Overview (`app/dashboard` and `lib/overview-service.ts`), Reports (`app/reports`, `lib/reports-service.ts`, `lib/report-csv.ts`), Settings/status/actions and shared desktop/mobile shell. Retained synthetic Task 24 screenshots were visually inspected; no live product UI verification is claimed.

| Existing behavior verified in code | v2.1 consequence |
| --- | --- |
| Overview already has time, estimated words, active days, sessions, daily rhythm, weekday distribution, library preview and shared status | Add one optional goals section; do not duplicate metric cards or status |
| Reports already has Day/Week/Month/Year, retained calendar reference, previous-period identity, four totals, session-length histogram, weekday chart, annual recap link and daily CSV | Extend monthly view; reuse these metrics and navigation. Existing monthly timeline groups by week; add daily resolution and selected-year monthly context |
| Settings already has detailed evidence, independent counts/run history, current-year selector, Start / Resume Session History and Backfill Library | Use existing operator path; goal editing belongs with the goal's Overview presentation, no new primary tab |
| Four primary tabs: Overview, Activity, Library, Reports; mobile Account exposes Settings and logout | Preserve navigation and current accessibility work |

Stale claims queued for **Task 32**, not comprehensively rewritten here:

- `README.md` “Scheduled sync” still says continuation/concurrency remain stabilization work; Tasks 12–15 implement fencing, atomic pages, durable history and bounded continuation.
- `README.md` “Remaining work” treats dependency patches, complete queries, streak/word/timezone behavior, repair tooling and CI as wholly open; current code and Tasks 02–24 implement them. Production proof remains separate.
- `docs/architecture.md` “Remaining stabilization work” similarly retains broad implementation claims about patches, continuation, tooling and CI. Later task-specific sections and current code are more precise.
- Architecture's historical Task 12 per-write boundary is explicitly superseded by Task 13; it must not be mistaken for the current atomic page boundary. Tasks 19–20 references to repair work mean implemented tools, not performed production repair.
- The Task 22 route inventory is a pre-change inventory; resolve its old navigation/reference defects against current code and final QA, not as present defects.

The approved plan controls scope; current code and task-specific operator/validation contracts control implementation claims. Repository evidence, successful CI, deployment status and verified production operation remain four different categories.
