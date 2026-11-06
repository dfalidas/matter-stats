# Task 30 — validation and handoff

Base: latest fetched origin/main `1db07bcfd8fab23119f1b8c35d80f1354efe2352`
on 6 November 2026, exactly the supplied baseline after Task 29 / PR #94. No
subsequent main commits or existing Task 30 branch/PR were found before creating
`task-30-monthly-review`. This change implements only Task 30's proposed rules in
the Task 25 specification. See [operator guide](task-30-operator-guide.md).

## Evidence status

Draft PR: https://github.com/dfalidas/matter-stats/pull/95, open/draft/unmerged.
Final executable application and harness source:
`c7f28b97e04afeeba6c3be7c693e58eecb40a70a`. The handoff commit changes documentation
and sanitized evidence only. Its exact final-head CI run, actual checkout SHAs,
artifact digests, visual inspection and status are recorded in the PR's validation
table (linked above); that table is the final-push evidence ledger. Earlier source
checks below must not be substituted for a later candidate's required gates.

Production, hosted staging, actual Matter history, sync/import/cron, migration/
repair, personal goals, manual deployment, promotion and merge are not executed
by this task. Local and CI isolation are category B evidence, not production
acceptance. No new migration, dependency or runtime configuration is required.

Focused behavioral tests use independent September/August expected numbers,
per-session rounding, zeros, read failures, coverage, current/future suppression,
calendar boundaries, selected-year totals and low-cap/tied-timestamp pagination.
The existing isolated browser workflow exercises the actual production-built
Reports page with synthetic SQL fixtures, keyboard navigation, resolution,
full CSV, independent outages and desktop/mobile light/dark screenshots; existing
weekly/yearly/navigation/security/database gates remain required.

## Initial attempts

- Initial focused run: 41/42 checks passed; one test incorrectly expected the
  established legacy comparison ratio field to contain 20 instead of 0.2. The
  assertion was corrected; Task 30 display arithmetic independently multiplies
  by 100. No legacy percentage contract was changed.
- Early exploratory full-suite run overlapped installation/source edits and is
  excluded from exact-SHA evidence regardless of its outcome.
- Host defaults were Node 24/npm 11; supported Node 22.23.4 and npm 10.9.10 were
  selected for locked installation and final checks without repository dependency
  changes. Three existing skill-directory lint warnings remain unrelated.
- Pinned CLI 2.48.3 npm postinstall failed locally. The official release archive
  was downloaded through the configured proxy; SHA-256 matches release checksums:
  `1d71e2c3c5a14456c34d2f015e487f9256ac15f2cb70b821337253f2478483cb`.

## Remaining acceptance

Draft implementation and synthetic validation do not constitute production
acceptance. Task 27 final real-history agreement after Task 26 completion and a
successful subsequent incremental cycle remains open; coverage and session–item
linkage remain independent. Conditional Task 28 and Tasks 31–32 are untouched.
No migration is needed; revert application changes for rollback. Craft log and
Action Plan v2.1 will be updated with actual evidence and the single draft PR.

Initial CI [42189685460](https://github.com/dfalidas/matter-stats/actions/runs/42189685460)
on executable `d97c2aaf15092aaf78aa41ed53a58e6c96b159e3`: verify passed,
but browser failed a fixture SQL CHECK (23514) before Task 30 assertions. The
fixture set `history_status=complete` without its required intent/generation/time
fields. Corrected the isolated fixture to satisfy the existing CHECK and restore
all original history fields afterward; no database constraint was changed.
Downloaded browser ZIP digest matched GitHub (`62b4050a9145c66eec48e0b419833ba03b4f7aee746010b058e8ea557af39898`).

Local isolated startup on `d97c2aaf15092aaf78aa41ed53a58e6c96b159e3` exhausted
the 7.9 GiB workspace disk before assertions. Only the two owned CLI startup
processes were stopped; browser harness classifies disk-capacity blocked, while
the fresh/upgrade harness records interrupted execution during startup. Neither
is a pass. Both runners verified owned resource and temporary-directory removal;
[sanitized evidence](evidence/task30/local-blocked/). Disk space recovered after
cleanup. No Docker prune, unrelated cleanup or production fallback was used.

Review also preserved the existing whole-minute chart display outside monthly
Reports; fractional minute coordinates apply only to the new monthly resolution.

Second CI browser attempt (`9660a7ef0174776915319cf4305ec5b24d4b0e97`,
[42190675643](https://github.com/dfalidas/matter-stats/actions/runs/42190675643))
passed fixture SQL but used a locator expecting a standalone “40 min” element.
The value shares a paragraph with its label, so the locator was corrected to
assert the full “Time per active day: 40 min” text. This changes no product
behavior or expected number. Downloaded ZIP digest matched GitHub:
`471b6e41b721b67d8d5db62b320a3d60b21d10ae8e8d941ad4a63a102d36ef06`.

## Verified source d0abb4a

A separate clean detached checkout at
`d0abb4ab840561ab626de324f20e3607bf559b65` passed the complete local sequence:
Node 22.23.4/npm 10.9.10, npm ci, route type generation, typecheck, lint,
**447/447 tests, 0 failed/skipped/TODO**, production build, unchanged audit policy
(full findings 0, production 0) and git diff --check. Start/end SHA and tracked
worktree remained identical and clean. Existing skill-directory lint warnings
remain; nested-worktree tracing-root warning did not change configuration.
[Sanitized local evidence](evidence/task30/verified-d0/local-checks.json).

[CI 42191549517](https://github.com/dfalidas/matter-stats/actions/runs/42191549517)
verify passed on PR merge `d285ef779ae5c14dd2b039761299f7e8d1139d5d`. Its
isolated browser passed on clean exact head d0abb4a: **13/13 phases**,
**50 browser behavioral checks**, **7/7 SQL/Data API groups**, zero page/console/
resource errors, unexpected network or real Matter requests. All owned cleanup
verified. Downloaded browser ZIP digest matches GitHub:
`1bd94695455d737064a7cea9a6c701848aabe92423a978faa9c3e4882984596a`
(artifact 13489364549). All five harness hashes match the exact tested source.
[Inspected sanitized evidence](evidence/task30/verified-d0/browser/).

All eight Task 30 screenshots were visually inspected (390/1440, actual class-based
light/dark, summary/chart views). Chart labels and zero/current/future states were
readable, with no horizontal overflow. Inspection identified cramped mobile trend
column separation and inconsistent summary capture scroll; the following candidate
adds column padding and consistently positions summary captures. It also keeps
unavailable comparison totals/deltas null inside the service, avoiding arithmetic
on a failed previous input, and restores only proven-new synthetic dirty markers
after fixture deletion. Required checks are rerun for that candidate; the earlier
verified source is not presented as proof of later changes.

Craft Project Log and Action Plan v2.1 now link the single draft PR #95 and explicitly
show implementation complete / validation in progress, with final updates pending
the remaining exact-candidate checks. No production acceptance is recorded.

## Final executable source and handoff ledger

`c7f28b97e04afeeba6c3be7c693e58eecb40a70a` passed the full local sequence again
in a separate clean detached checkout (identical clean start/end SHA): npm ci,
route type generation, typecheck, lint, **447 tests / 0 failed / 0 skipped / 0 TODO**,
production build, audit:ci (**0 full findings / 0 production vulnerabilities**)
and git diff --check. Node 22.23.4/npm 10.9.10.
[Exact-source local evidence](evidence/task30/verified-c7/local-checks.json).
The focused current/previous/year-failure, metric and report suite also passed
52/52 checks after the nullable comparison change. Existing numeric assertions
still require their independent constants: optional access only reflects the new
unavailable type and does not accept an absent successful result.

Final-source refinements after d0abb4a:

- A failed comparison has null totals and delta inside the service as well as
  the client payload; no percentage/delta arithmetic runs against fake zero input.
- Trend table cells have explicit column spacing at mobile widths. Summary
  screenshots use a consistent scroll position in light/dark.
- Synthetic fixtures restore their intent fields and remove only dirty markers
  in a date range asserted empty before seeding, after deleting those fixture
  sessions. Later ingestion tests keep their original input. No production state
  or real ingestion controls are touched.

The prior [CI 42191549517](https://github.com/dfalidas/matter-stats/actions/runs/42191549517)
completed **SUCCESS 3/3 jobs**. Its fresh/upgrade job tested clean exact d0abb4a:
**29/29 phase groups**, **21 migrations per path**, synthetic backup/restore
**10/10 groups / 27 tables**, fresh/restore/upgrade and temporary cleanup verified.
No failed/skipped/TODO/blocked/not-run/running phase remains in that run.
Database artifact 13491455496 downloaded/inspected; ZIP SHA-256 matches GitHub:
`a4cbc4e27f8009bdeb4de20f5d97631104d2c975c7125502e159bf1be5d30b00`.
Audit artifact 13490441316 downloaded/inspected, full/production findings 0;
ZIP SHA-256 matches GitHub:
`3789aa5f3630e8d308ff61a7fc3989af6db52405893a4772cea918018c971070`.
[Database evidence](evidence/task30/verified-d0/database/) /
[audit reports](evidence/task30/verified-d0/audit/).

The final push is checked independently through the unchanged three CI jobs.
See the PR validation table for its actual final head and merge checkout SHAs,
completed statuses and inspected artifact results; pending checks are never
presented as passed. Automatic Vercel Git previews are reported separately there
and do not establish isolated hosting or production runtime acceptance.

Craft's Project Log and Action Plan v2.1 have the PR link and implementation
status. Their same dated entries are finalized with the exact handoff SHA and
observed final CI/artifact results, without recording production acceptance.
Operator guide covers UI choices, formulas, complete-month/coverage rules, query
impact (bounded year scan + three status reads, no all-history streak scan for
monthly Reports), live-read consistency limits, no migration and revert rollback.
Task 27 final real-history acceptance remains after Task 26 terminal evidence and
subsequent incremental success. No Task 26/27/28/31/32 closure is claimed.
