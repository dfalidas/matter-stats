# Task 26 operator handoff — all available source history

**Prepared, not executed by Task 25.** Real import operations belong to a subsequent explicitly scoped Task 26. Read [Task 25 baseline](task-25-baseline.md), the private Craft inventory, [Task 21 status](task-21-status.md), [Task 15 policy](task-15-validation.md) and the [release runbook](security-release-runbook.md) first. Refresh state immediately before action; ordinary cron may have progressed since the inventory.

## Read before acting

Use existing authenticated Settings → Matter sync health / detailed synchronization status, plus the [read-only SQL](task25/inventory-read-only.sql) through an authorized server-side connection. Never call a mutation to discover state. Check sessions and library separately; inspect history status, pinned coverage, cursor-present flag, retry eligibility/recovery, active lease expiry, dirty dates and generation/barrier state. Retain exact times privately, without raw cursors/owners/cache bodies.

| Existing intent | Later Task 26 action after preflight |
| --- | --- |
| `none` / no request timestamp | Explicitly choose **Start / Resume Session History** in Settings, or **All available sessions** with Sync Recent Activity. Both request the same durable `all` intent; no custom lower-bound history is offered |
| `pending` | Full history is queued. Continue the existing pinned narrower cycle; do not clear/recreate it. When it exhausts, the scheduler binds a new full-history cycle; it may begin in that invocation if budget allows |
| `running` | Resume the same durable full-history work through eligible cron or one controlled manual continuation; no second importer |
| `complete` | Repeated explicit history requests are idempotently complete and do not restart enumeration. Verify terminal evidence and subsequent ordinary incremental operation. Any newly desired re-enumeration is a separate decision, not a reset instruction |
| Missing/unavailable/inconsistent evidence | Stop dependent action and resolve read/migration/configuration evidence. Do not treat missing as `none`, idle or complete |

Code source: `app/dashboard/sync-matter-button.tsx`, authorized `app/dashboard/actions.ts`, `lib/matter-sync.ts` and history-intent migration. The explicit history button requests all coverage regardless of the ordinary recent-window selection. Selecting `All available sessions` in the recent selector has the same intent. An active narrower cycle keeps its exact endpoint/filters/limit/cursor/generation until terminal exhaustion. A conflicting ordinary narrower selector is rejected rather than rewriting that contract. Full-history cycle uses `/reading_sessions` **without `since`**: include years before 2026 wherever Matter returns them.

## Independent metadata work

**Backfill Library** is the existing manual path to start/resume the independent `/items` enumeration (`status=all`, documented updated ordering). It prepares supported item metadata, embedded tag relationships and annotations via the existing bounded API paths. Cron resumes an **already active** library cycle; it does not initiate an unrequested library backfill. Session import may fetch documented linked items where a usable ID exists, but cannot substitute for library completion. Global library tags/annotations are supported metadata, not separate durable stream rows or a guarantee of all historical/deleted content. Check optional unavailable endpoints and missing fields explicitly.

Current library metadata does not prove previous library membership. Missing session item identifiers do not permit inferred author/source/topic attribution. Track metadata counts and terminal completion separately from session enumeration; do not wait for guessed linkage as an ingestion prerequisite.

## Continuation and diagnostics

See [Task 26A budget continuation](task-26a-validation.md) for the narrowly scoped
admission/finalization correction and its limits. Safe budget pauses retain
preparation for eligible scheduled continuation; pre-existing unknown requests
still require deliberate eligible manual recovery.

Daily cron remains **06:00 UTC** (`0 6 * * *`, local time changes with DST). It resumes recent sessions, queued/running history and active library work under the same single-account lease and durable fair stream turn. Browser need not remain open. Optional authorized manual continuations accelerate eligible work; use one at a time and allow natural cooldowns. No parallel importer, rapid polling loop, quota increase, schedule change or cursor reset.

Preserve **8 committed pages / 224 HTTP attempts / 90s upstream preparation / 150s invocation / 10s attempt and database HTTP / 180s ingress**. Shared quotas remain 120 GET/minute, 5 requests/second and 20 markdown GET/minute; upstream feedback may tighten them. Three-attempt transient chains, bounded backoff/waiting, 429 cooldown, durable preparation and deliberate eligible recovery remain unchanged. Expired exhaustion does not auto-reset; manual recovery is deliberate, after the existing 15-minute eligibility and diagnosis, preserving the page contract and prior successful preparation.

| Evidence | Demonstrates | Does not demonstrate |
| --- | --- | --- |
| Bounded invocation outcome/counters and retained receipt/stream state | Partial work and durable continuation; counters may include idempotent upserts | Unique new records, worker liveness, stream completion or historical percentage |
| Preparation reduction, retry deadline/manualRecovery, stream/legacy cooldown | Cached reads, pause/recovery conditions | Committed rows or a promise of immediate next execution |
| Lease expiry | Ownership eligibility at the observation instant | Worker health; an old running log is not active ownership |
| `matter_cycle_completions.completed_at` with matching stream/generation/source boundary and exhausted stream | Validated terminal page transaction was observed, including empty terminal page | Universal source retention or full account history |
| `matter_sync_continuation.history_status='complete'` | Bound all-available history intent reached terminal transition | Independent metadata completion; its `completed_at` is the cycle-start boundary |
| No unexplained dirty/preparation/retry/error work plus successful next incremental cycle | Operational follow-through after import | A repaired historical derived baseline or complete historical membership |

Progress records should include observation time, intent/cycle identity (privately), actual stored counts/date extent, last proven completion, changes since prior observation, pending work and errors. There is no trustworthy percentage/ETA without a known denominator and observed throughput. Use changes in unique stored counts carefully: overlapping upserts may do useful work without increasing count. Last stream `updated_at` is a state-write proxy; receipts have no per-page timestamp. Do not invent a precise last-progress time where unavailable.

## Evidence required before Task 26 begins

- [ ] Review Task 25 deliverables/product proposals; read the private live inventory and refresh it read-only.
- [ ] Verify actual deployed SHA/configuration and compatible full migration/RPC/ACL chain. A readable catalog or success Git status is insufficient; migration-history lookup was unavailable in Task 25.
- [ ] Confirm server-only configuration, validated APP_TIMEZONE, quotas/retry behavior and effective runtime bounds. Resolve relevant v2.0 sync operational checks with the user; preserve the user's ownership of the broader v2.0 gate list.
- [ ] Identify operator/abort owner and private evidence location; inspect lease, cooldown, preparation, errors, frozen/candidate generation and dirty revisions. Explain any outstanding state before requesting work.
- [ ] Verify existing intent so the selected action continues or queues correctly. Record sessions and metadata scopes independently and retain existing IDs/checkpoints/receipts.
- [ ] Confirm this next task authorizes the intended real import; Task 25 did not start/resume/reset/restart it.

## Completion and following tasks

Task 26 is complete only after documented exhaustion of **available API enumeration** for each agreed stream, pending ingestion/preparation/dirty rollups/retries/errors explained or resolved, no duplicate session counting on continuation, and verified subsequent incremental operation. Retain terminal observation separately from source watermark. Report “Imported what the API made available”; no guarantee of complete account history or historical library membership.

Task 27 then reconciles raw sessions/screens/CSV with common boundaries and a coherent snapshot or declared concurrency limits. Task 28 is conditional on justified stored-derived discrepancies and its preview/production-workflow/backup/restore/cutover gates. No repair CLI, generation change or all-history rebuild is part of this import handoff.
