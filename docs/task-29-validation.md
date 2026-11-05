# Task 29 — validation and handoff

Draft PR: https://github.com/dfalidas/matter-stats/pull/94 (leave open, draft and unmerged).
Baseline: GitHub latest main and fetched origin/main both
`a6e968e4a0b1f1e3379573df4312a90f240cade8` on 2026-11-05. No Task 29 PR/branch
was found before creating `task-29-reading-goals`. Read AGENTS, architecture,
security runbook, Task 24 verification guide, Task 25 spec/backlog and Craft
Action Plan v2.1 Task 29. User-supplied production/scheduler observations are
historical context, not newly verified production evidence.

## Behavior and scope

Two optional current-period goals in Overview, independent of selected/custom
analytics dates, fixed to Europe/Athens. No numeric default or carry-forward.
Create/edit/disable retains exact integer seconds, period isolation and raw
sessions. Coverage uncertainty and independent read failures stay visible.
Attainment can exceed 100%; only the bar clamps, with zero remaining/pace after
achievement. DST/local calendar pacing is a required average, never a forecast.
See [operator guide](task-29-operator-guide.md) for precision, denominator,
migration-first rollout, constraints, concurrency and non-destructive rollback.

Ten new application tests cover decimal precision (including the maximum exact
editable value), Monday/week/year rollover, 23/25-hour days, leap year, zero/
exact/excess/expired states, stale forms, unauthorized/invalid writes, errors,
and complete capped raw pagination. The >1,000-row fixture uses independent
expected totals, boundary/future exclusion and canonical duration normalization.

The existing real database suites add CRUD grant-denial controls for anon and
ordinary authenticated users, positive service-role controls, numeric/calendar
CHECK rejections and 12 simultaneous upserts with exactly one persisted period
record. Upgrade snapshots compare every pre-existing source/control table
before/after the new migration. Browser journeys add real form/server/database
create/reload/edit/disable, retained input after failure, separate goal/analytics
outages, historical isolation/filter independence, keyboard submission and a
revoked-session replay that leaves every persisted goal column unchanged.

## Tested application source

Executable/application test source: `086e7039cda8c20d69a9f509cc75986a8890f17b`.
Node **22.23.4**, npm **10.9.9**, locked installation, route type generation,
typecheck, lint, **431/431 tests / 0 failed / 0 skipped / 0 TODO**, production
build and unchanged audit policy passed locally. Full audit **0** findings,
production **0**. Three existing local skill-directory lint warnings remain.
The only later verifier adjustment activates the existing `.dark` class (the
application uses class-based dark mode) and scrolls screenshots to the goals.
It changes no application behavior. Exact final checkout identities and results
are in PR #94's validation table and linked CI artifacts; do not confuse a prior
application-source result with a later final-head result.

[CI 42031208666](https://github.com/dfalidas/matter-stats/actions/runs/42031208666),
attempt 1, tests application source `086e703`. Verify checks out PR merge
`ef31bad5ca7c1b561c40320ad3b96066318c5c01`; isolated jobs check clean exact PR
head `086e703`. Verify passed typecheck/lint/431 tests/build/audit. Browser
artifact was downloaded and inspected: **13/13 phases**, **46 browser checks**,
**7/7 SQL/Data API groups**; zero page/console/resource errors, unexpected network,
real Matter requests or actual database error responses. Application processes,
browser, owned stack and temporary directory cleanup verified. Its media-only
screenshots do not certify class-based dark mode; the follow-up harness corrects
that explicitly. Final screenshots/visual inspection are linked from PR #94.

Browser artifact `13416353376`: downloaded ZIP SHA-256 matches GitHub digest
`add5b352c7a3d881481ead88680f80302673702e9f78e2de218173db085be3f4`.

The same run completed **SUCCESS 3/3 jobs**. Fresh/upgrade artifact was downloaded,
inspected and verified: **29/29 phases**, **21 migrations per path**, 12 security
fixtures per path (including goal controls and 12 concurrent upserts), synthetic
restore **10/10 groups / 27 tables**, complete owned fresh/restore/upgrade and
temporary-directory cleanup. No failed/skipped/TODO/blocked/running phase remains.

DB artifact `13418005437`: SHA-256
`06582cd24b06715a81382664b8981743813a3822dc1c9acccdb7d7663ede4be1`.
Audit artifact `13415708558`: SHA-256
`21d863493d408f83211cfc6d7d65dd5d0f94dd4137d560d2c769f6be2d4d910a`.
Both downloaded ZIP digests match GitHub. Browser harness hashes match the
exact tested commit. [Inspected sanitized evidence](evidence/task29/verified-086e/).
The final verifier/documentation commit's exact-head CI and inspected visual
results are recorded in the PR's validation table, separately from this run.

## Preserved failed/blocked attempts

- Initial sandboxed run encountered child-process restrictions; terminated owned
  lingering test processes. Not final validation.
- Exploratory runs overlapped installation or later edits and are excluded from
  exact-head evidence even when they reported successful tests.
- First candidate's test compilation rejected a dynamic extensionless NodeNext
  import; corrected to the repository's static-import convention.
- Local fresh/upgrade startup at `06889dd` blocked on **disk-capacity** before SQL
  assertions; the overlapping local build hit ENOSPC. Both excluded from passes.
  [Sanitized evidence and verified cleanup](evidence/task29/local-blocked/).
- Local browser/Supabase startup at `9c169b2` also blocked on **disk-capacity**,
  before application/browser creation. [Evidence and verified owned cleanup](evidence/task29/local-browser-blocked/).
- Pinned CLI npm postinstall could not route node-fetch through the proxy. The
  official CLI 2.48.3 archive was fetched over the configured proxy and SHA-256
  verified against release checksums; `supabase migration new reading_goals`
  generated the migration filename. Supabase changelog/RLS docs were consulted.
- Earlier CI runs superseded/cancelled by subsequent pushes are not final passes.
  Dependency versions, audit policy and all required CI gates remain unchanged.

## Operational boundary

These are isolated synthetic category-B checks. Hosted staging, production,
real synchronization and scheduled delivery were not verified or invoked here.
No production SQL/migration, Matter sync/import/cron, reset/repair, manual
deployment, merge, quotas/retries/schedule/cursor/generation change. Task 26
remains in progress, Task 27's real-history acceptance pending, Task 28 separate.

Next: review draft and exact-head evidence; only after separate rollout approval,
apply ordered migration `20261105123642_reading_goals.sql` before compatible code,
verify private grants/constraints and existing-state preservation, then release
and smoke-test authenticated goals. Roll back application while retaining the
additive table if needed. No production rollout was performed for this PR.
