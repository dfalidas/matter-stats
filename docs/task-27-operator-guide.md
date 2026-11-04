# Task 27 — historical reconciliation

This is preparatory work while Task 26 continues. Agreement is not source completeness.
No sync, repair, migration, cron, generation or cursor mutation is part of this tool.

## Repeatable isolated checks

Use Node 22/npm 10 and the Task 24 disposable setup requirements:

```sh
npm ci
npx --no-install next typegen
npm run typecheck
npm run lint
npm test
npm run build
npm run audit:ci
DISPOSABLE_DB_ACK=yes STABILIZATION_TEST_IMAGE_REGISTRY=docker.io npm run test:full-stack
DISPOSABLE_DB_ACK=yes STABILIZATION_TEST_IMAGE_REGISTRY=docker.io npm run test:stabilization-db
```

`tests/history-reconciliation.test.ts` invokes `reconcileHistory(client, '2024-02')`
or `reconcileHistory(client, '2024')` with real Supabase query builders and a capped
synthetic transport. The function is a server-side read-only operator API, not a
public route. Supply only an authorized server client; it returns aggregate evidence,
never session IDs, titles or URLs. Do not publish private results automatically.
The existing Task 24 browser harness adds real SQL reference comparisons and schema
assertions to its downloaded CSV tests, rather than duplicating browser setup.

Each comparison includes period, UTC bounds, timezone, filters, source, metric,
expected, actual and signed actual-minus-expected difference. Zero differences
mean agreement for those inputs. `mismatch` needs investigation, never automatic
repair. `inconclusive` means data changed between raw reads; repeat later against
an agreed stable dataset. Errors reject the operation; they are not empty results.

## Definitions and limits

All periods use Europe/Athens calendar `[start,end)` and session start attribution.
Historical Overview uses explicit custom dates: current presets are period-to-date
and must not be compared to complete Reports periods. Activity exposes a month;
a year comparison sums twelve months, including all days rather than just its
selected day or 20-row display page. Full raw pagination uses the existing stable
(started_at,id) keyset reader, including server-capped short pages.

Seconds are raw integer duration; words are rounded per session at 225 WPM then
summed. Active days mean positive-duration days, derived from calendar buckets;
zero-duration sessions count as sessions but not active days. CSV has no active-day
column: it is derived from days with positive seconds. Some screens expose these
only as calendar buckets, not summary cards. Service evidence includes exact
seconds; UI duration/word labels may round or abbreviate and cannot certify exact
values. Articles are distinct linked items, never a substitute for session count.

The check reports missing timestamps and NULL durations separately. The actual
schema permits both; NULL duration contributes zero and undated rows cannot enter
a dated period. Negative/fractional/non-numeric durations are not valid integer
nonnegative stored inputs. Duplicate primary IDs are rejected by PostgreSQL;
duplicate transport rows are rejected by the complete reader. The browser harness
asserts duplicate/negative rejection and NULL acceptance against the migrated DB.
Unlinked sessions remain included; absent linkage limits attribution only.

Independent service requests cannot share PostgreSQL repeatable-read through the
Data API. Before/after raw fingerprints detect observed changes but cannot exclude
transient/reverted writes; unchanged fingerprints are not an MVCC guarantee.
The isolated fixtures have no concurrent writer during analytics checks. Production
acceptance requires an agreed stable observation window or separately captured
snapshot evidence, and explicit documentation of this limitation.

Three independent conclusions must remain separate: metric agreement, Matter
available-stream completion, and session/item attribution. Task 26 must document
agreed stream exhaustion and successful subsequent incremental operation before
a final reconciliation on then-current data. Neither synthetic success nor matching
screens proves full account history. Task 28 remains conditional and unauthorized.
