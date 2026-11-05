# Task 29 validation

Baseline: GitHub latest main and fetched origin/main both
`a6e968e4a0b1f1e3379573df4312a90f240cade8` on 2026-11-05. No Task 29 PR/branch
found before creating `task-29-reading-goals`. Read AGENTS, architecture, security
runbook, Task 24 verification guide, Task 25 spec/backlog and Craft Action Plan
v2.1 Task 29. Prior production and scheduler observations supplied by the user
are historical context, not newly verified here.

Implementation and validation in progress. Final tested SHAs/results will be
recorded after checks. This file does not claim completed verification.

Local setup: Node 22.23.4; npm 10.9.9 selected separately from inherited Node24/
npm11. Pinned CLI 2.48.3 npm postinstall failed to route node-fetch through proxy;
official release archive fetched over the configured proxy, SHA-256 checked
against release checksums. `supabase migration new reading_goals` generated the
migration filename. Changelog and RLS docs read; platform breaking changes do not
change the pinned disposable stack or private grants contract.

Early sandboxed test run cannot certify the change (child-process restrictions).
A subsequent exploratory run overlapped clean installation and is not counted as
final validation. Final checks must run sequentially after locked installation.

See [operator guide](task-29-operator-guide.md) for semantics, deployment order and
non-destructive application rollback. Isolated evidence is never production
certification. No real Matter/production action authorized or performed.
