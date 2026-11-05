# Task 29 — optional reading goals

Goals are private, single-user, and fixed to Europe/Athens, independently of
APP_TIMEZONE and the Overview filter. A Monday week and a calendar year each have
one optional record per local start date. No default target, historical chooser,
automatic carry-forward or writes at rollover. Save re-enables that period;
disable retains its value and all sessions. Closed/stale forms are rejected.

Input accepts positive decimal hours with at most two fractional digits, parsed
as integer hundredths multiplied by 36. Storage uses bigint seconds constrained
to positive multiples of 36 within JavaScript's exact integer range. No floating
point hours are persisted. Concurrent upserts share a composite primary key;
last committed submission wins, never duplicate records.

Actual time uses canonical raw session durations with start <= started_at < now,
complete keyset pagination and a common request-captured now. The week that spans
New Year includes December sessions. The normal analytics live-pagination
consistency limits apply; this is not an MVCC snapshot or proof of upstream
coverage. Failed goal reads and failed analytics stay distinct from absence/zero.
Coverage qualification remains visible; no year-end forecast/on-track claim.

Pace denominator: count of local calendar days from today's midnight to the
exclusive period end, minus elapsed fraction of today. Today's fraction uses its
actual midnight-to-midnight duration (23/24/25 hours); subsequent days each count
as one. Before start use the full day count; at/after end use zero and show ended.
Remaining seconds clamp at zero; attainment can exceed 100%, bar cannot. Positive
required pace rounds up to minutes/day only for display. E.g. Friday noon with
2 hours remaining before Monday needs 48 min/day (2.5 days). No division by zero.

## Rollout — separate operator authorization required

1. Review the draft and exact-head CI/artifacts, including disposable fresh and
   upgrade security/concurrency and real browser/server/Supabase evidence.
2. After separately authorized review/merge/rollout, apply the ordered migration
   chain through `20261105123642_reading_goals.sql` **before compatible code**.
   Do not run reset. This adds only an empty table, RLS, constraints, service-role
   CRUD grants and an updated-at trigger. No anon/authenticated policies/grants.
3. Verify migration history, composite key, period/seconds CHECKs, RLS, grants,
   and ordinary-role Data API denial. Existing source/control state must match
   the pre-migration snapshot. New goals table must be empty.
4. Release compatible application code and verify authenticated create/reload/
   edit/disable for an explicitly chosen target, filter independence, errors and
   coverage labels. A deployment status alone does not establish these checks.

Rollback application to baseline `a6e968e4a0b1f1e3379573df4312a90f240cade8`;
retain the additive table and its values/security for later recovery. No down
migration or deletion of goal/session/history records is needed. Removing the
table would be a separate destructive decision after backup and dependency review.
No production migration, sync/import/cron, repair, reset, deployment or merge is
part of this implementation. Tasks 26, 27 and 28 retain their acceptance gates.
