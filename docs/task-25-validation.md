# Task 25 validation

Baseline: `32f23cc8260acf9afd90087e28f9dde1993d7ed8`; review date 2026-10-23 Europe/Athens. Documentation-only change. Final documentation checks and PR identity are recorded below and in the private Craft log.

## Inspected

- Root AGENTS.md (no nested tracked guidance), refreshed default branch, remote branches and existing PRs/documents; approved Craft Action Plan v2.1 and project log.
- Current Overview/Reports/Settings/mobile shell and navigation, sync actions/runtime, analytics/calendar/estimate/CSV services; Tasks 14–15, 19–24 documentation, architecture, deployment and release runbook. Existing inventory scripts are contract/catalog manifests for isolated validation, not a production inventory command.
- Retained synthetic Task 24 Overview desktop, Reports mobile and Settings partial-state screenshots. Current code resolves historical pre-change route-inventory statements.
- Exact-baseline GitHub CI jobs and Vercel commit status. This reads metadata only; artifacts/cleanup, deployment identity and production runtime were not independently certified.

## Executed

- Read-only production catalog projection before inventory; two 15s-bounded repeatable-read aggregate/status transactions at 13:36:00.900981 / 13:36:30.447092 UTC; follow-up integrity projection at 13:37:49.432850 UTC. The first two explicitly returned `transaction_read_only=on`; all were explicitly READ ONLY with ROLLBACK. Existing stable retry/generation status functions were reused; no mutation RPC was invoked.
- Personal results are retained only in private Craft, with per-finding timestamps, source/environment/confidence and interpretation. The public query source is reproducible and contains no personal outputs.
- One combined optional integrity/migration-history query failed because `supabase_migrations.schema_migrations` was absent; **none of that failed statement's aggregates counted as results**. The bounded follow-up re-ran integrity checks separately and safely checked relation presence. Full applied-migration verification remains incomplete.
- A 10s-bounded read-only role-capability check at 13:43:04.133431 UTC confirmed the inventory execution role bypasses RLS, so these aggregates are not an anonymous/user-policy subset. This is not a test of deployed service-role grants or browser-role denials.

## Not run / limits

- **NOT RUN:** real Matter API/synchronization/import/history request, application cron/manual action, production app login/UI journey, production deployment/configuration changes, migrations, backup/restore, historical preview/repair CLI, generation changes or merge.
- **NOT RUN:** runtime application tests/build/lint/security/database harnesses; no runtime/dependency/schema change warrants introducing or re-running them for this documentation task. Baseline CI success is existing exact-SHA evidence, not a newly executed suite.
- **NOT VERIFIED:** complete upstream account history or prior library membership; full deployed migration/function/ACL identity; hosted staging; post-merge artifact cleanup; two real scheduler deliveries; production backup/restore. Database invocation observations do not close those gates.
- The three read snapshots are separate. No screen/CSV reconciliation or repair need is inferred from this inventory. Exact last nonterminal progress time is not durably recorded by receipts; proxies are labeled in the private log.

## Documentation acceptance

Documentation checks: local relative Markdown destinations, HTML fragment targets, CSV header against source, independent synthetic arithmetic (goals, daily totals, monthly totals/averages/per-session estimates), read-only SQL shape and personal-output/secret exclusion were checked. `git diff --check` passed.

Static mockups were rendered with system Chromium at **1440×1000 light**, **390×844 light** and **390×844 dark** using a loopback-only document server; all three had zero page errors and no horizontal page overflow. [Recorded observations](task25/mockup-validation.json) and screenshots accompany the HTML. Desktop, mobile goals/reports and dark full-document images were visually inspected. The wireframe's footer presents the existing four mobile tabs as part of the static document outline; production bottom-bar behavior is not changed or validated. Initial direct `file:` rendering was blocked by browser policy; it was stopped and replaced by ordinary loopback HTTP rendering. No product server or production request was needed.

Supabase changelog and database-function guidance were consulted; no platform, extension, schema or transport change is proposed. No runtime tests were added.

Baseline, dependency map, implementation-ready formulas/edge cases, synthetic static wireframes, read-only query source and Task 26 operator checklist are provided. Task 25 is **ready for review of these deliverables and observed inventory**, not a declaration that Tasks 26–32 or v2.0 operations are accepted. Remaining live verification limits and product decisions remain visible. No missing production baseline is filled with synthetic examples.
