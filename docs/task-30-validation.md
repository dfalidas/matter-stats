# Task 30 — validation and handoff

Base: latest fetched origin/main `1db07bcfd8fab23119f1b8c35d80f1354efe2352`
on 6 November 2026, exactly the supplied baseline after Task 29 / PR #94. No
subsequent main commits or existing Task 30 branch/PR were found before creating
`task-30-monthly-review`. This change implements only Task 30's proposed rules in
the Task 25 specification. See [operator guide](task-30-operator-guide.md).

## Evidence status

Implementation validation is in progress. Exact tested executable/final SHAs,
local results, CI identities, isolated browser/database results, artifact inspection
and automatic preview status will be recorded here before handoff. Pending or
blocked gates are not passes. Production, hosted staging, actual Matter history,
sync/import/cron, migration/repair, personal goals, manual deployment, promotion
and merge are not executed by this task.

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
