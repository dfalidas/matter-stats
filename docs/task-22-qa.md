# Task 22 / H3 / W7 / R10 focused UI QA

Base: `300cf87cfa7454597e59a1619bcedc4da9af3681` (fetched main; no subsequent changes). Scope is presentation, route/input handling, directly necessary error mapping, regression tests and synthetic evidence. [Route inventory](task-22-route-inventory.md) records pre-edit behavior, guards, useful functions and dispositions. All useful secondary routes are retained.

## PR #85 Reports calendar-reference correction (20 October 2026)

Fetched main and the existing draft PR branch before editing: base/main `300cf87cfa7454597e59a1619bcedc4da9af3681`; reviewed/local/remote head `880fafb4db67b0a08c0f8ff2e717f1d88786c8ba`. There were no subsequent commits or tracked edits. Preserved all existing commits, evidence and untracked interrupted screenshots. No active task build/test/browser process remained; defunct children were left alone. The original route inventory, other UI fixes and Task 21 status contract remain unchanged.

**Missed case and root cause:** the original successful Reports evidence exercised year/month transitions, while the conversion unit test used an unavailable report. Successful reports inferred their selection from the first heatmap day. A weekly Monday boundary such as 2024-12-30 therefore replaced the retained 2025-01-01 calendar reference. Year → Week → Year incorrectly became 2024; the recap link followed that incorrect year. March 2025 similarly drifted to February through its cross-month week.

**Reference rule:** the server applies the existing period/reference validation (first parameter value, `date` taking precedence over legacy `weekStart`) and resolves missing/invalid references to APP_TIMEZONE's local today at the requested frequency. It passes that calendar reference as one bounded string to Reports, for successful and unavailable queries alike. Frequency conversion, the submitted input and annual recap use this selection. Explicit Apply changes the URL selection. Existing URL copying preserves unrelated/repeated parameters and browser history; no client selection state, new URL parameter or report-service architecture is introduced.

Aggregation remains independent: weekly ranges still start on Monday and may cross a month/year. Range labels and previous-period comparisons use the actual service ranges; CSV content and names continue to identify the actual aggregation range. For `weekly&date=2025-01-01`, the input and recap retain 2025 while the visible dates are 2024-12-30–2025-01-05, previous week 2024-12-23–2024-12-29, and filename `matter-stats-weekly-2024-12-30.csv`. Synthetic boundary sessions total 601 seconds, 2,254 canonical estimated words and two sessions; the exact exclusive endpoint session is excluded. No calculation, timezone, Monday grouping, half-open boundary, previous-period formula or canonical CSV column changes.

Changed runtime files: `app/reports/page.tsx` (validated selection) and `app/reports/reports-overview.tsx` (selection separate from range/export reference). `tests/ui-presentation.test.mjs` exercises the actual page → report service → bounded successful payload against capped synthetic Data API fixtures. The existing browser harness/fixture add a Reports-only phase and isolated boundary scenario. No changes to other application routes, shared libraries/status, authentication, migrations, dependencies, audit policy, workflows or synchronization controls.

Application/test source: `22f639a475e73f911b2c6e41f3e662dceceb1547`; production build source: `3c54ea8511d90538074a9c9d328eb067a917229c`; final browser harness source: `8192206bb1995440248110e117776a1296108f36` (synthetic root-theme restoration and the existing session-query outage fixture; application/test trees identical). New evidence is separate from the historical phases: [Reports correction evidence](evidence/task22/reports-reference/README.md). The prior 159 checks are retained as historical results; they do not prove this boundary case. Current-source checks and limitations are recorded below and in the PR's exact final-head CI report.

| Current correction validation | Result / evidence |
| --- | --- |
| Locked install, route types, typecheck | Passed; 456 packages, dependency files unchanged |
| Lint | Passed, no errors; eight existing local warnings (three skill files, five scratch-script warnings); final one-line browser-fixture correction separately linted with zero warnings |
| Focused real service/presentation/payload/CSV tests | 29 passed / 0 failed / 0 skipped |
| Full existing application suite | 388 passed / 0 failed / 0 skipped |
| Production build, diff and scope checks | Passed; all routes generated; no protected-boundary changes |
| Unchanged local dependency audit policy | **Failed**, exit 1: eight high development finding entries, zero production vulnerabilities; `tailwindcss-animate.fixAvailable=true` expires the existing exception. No dependency or policy change. Historical local/CI metadata discrepancy remains documented in PR #85. |
| Reports browser phase | Passed at 390/768/1440, touch/keyboard, light/dark: 12 recorded render checkpoints, three comprehensive behavior groups, eight screenshots. Five representative final renders visually inspected. Year/month/leap, recap, Apply, history/reload, repeated context, invalid/missing/legacy references, unavailable navigation and nine actual weekly CSV downloads passed. |
| Existing interaction flow | Passed again: 14 recorded checkpoints, six behavioral groups, four screenshots; annual CSV/labels/recap/history/legacy plus unchanged Overview, Activity, Library and synthetic account behavior. Both phases total 26 checkpoints, nine behavior groups, 12 screenshots; zero browser/console/resource errors, unexpected mutations, external requests or detail prefetches. |
| Local disposable database suite | Not enabled, not counted as a pass or an application-test skip. Exact final-head CI jobs/results are reported in PR #85. |

The first new browser attempt at `3c54ea8` failed a harness assumption: generic `unavailable` intentionally leaves raw-session reads available, so Reports correctly remained available. The runner now uses the existing `metrics-error` scenario. That failed attempt and its screenshots are preserved under `work/reports-reference/reports-attempt1`, excluded from passed results; [development attempt record](evidence/task22/reports-reference/development-attempts.json) records it. No application error mapping changed to accommodate the test. Original audit/build/browser and reviewed-head CI failures below remain historical and have not been relabeled as passes.

Compatibility: no migration, configuration or dependency change. An application-only revert of the two Reports runtime changes restores prior presentation; preserve all Task 21 migration, progress, status and invocation/run evidence. No rollback, deployment, real sync, production SQL or repair was performed. Synthetic Reports tests say nothing about completed production synchronization, scheduled continuation or upstream historical coverage. Existing Task 23/24 and external release gates remain separate.

## Original recovery assessment (19 October 2026)

Resumed on 19 October 2026 on the existing `task22-focused-ui-qa` branch at `ab82dea01365223ceaec9ff8ed7028ba671173db`. Fetch confirmed that main and the merge base still equal `300cf87cfa7454597e59a1619bcedc4da9af3681`. No rebase/reset/clean or worktree replacement was performed. There was no existing Task 22 PR. All five Task 22 commits and the uncommitted screenshots were preserved. No build/test/browser process was still active; defunct browser children were left alone.

| Area at resume | Assessment | Remaining work |
| --- | --- | --- |
| Route inventory, scope/compatibility documentation | Complete with source inspection evidence | Add final validation provenance and CI outcome |
| Overview/Activity/Reports/Library/detail/shell/secondary fixes | Implemented; unit coverage completed for the prior source, final navigation/prefetch edits awaiting current browser verification | Verify current rendered behavior, retaining successful earlier evidence only for unchanged paths |
| Shared status interpretation and operational boundaries | Complete with existing contract tests and diff inspection | Exercise final synthetic state matrix; no production operation |
| Full application unit suite | 384 passed, 0 failed/cancelled/skipped in the completed pre-interruption log; compiled source `96cf5adae4d8951e889e9ea1d93cdbba49ae1774` | Current-source focused tests/browser plus exact final-head CI; do not use this run to certify subsequent navigation/prefetch changes |
| Production build | Completed at current application source `ab82dea01365223ceaec9ff8ed7028ba671173db` | Current browser verification against that artifact |
| Route types/typecheck/lint/audit | Earlier attempts/results present; last typecheck failed because a concurrent build replaced generated types | Run types/typecheck sequentially and capture fresh lint/audit exit results |
| Browser screenshots and behavioral matrix | Partially verified; prior navigation timeout left an incomplete run without a completed manifest | Fresh full run in `evidence/task22/completed/`, inspect actual renders; preserve earlier root screenshots as interrupted work, exclude them from final evidence |
| Draft PR/final-head CI | Not started | Push preserved branch, open one draft PR, inspect its final checks |

No partially implemented feature or unrelated user edit was identified. Runtime changes remain confined to presentation/input normalization; metrics, authentication, synchronization machinery, migrations, dependencies and CI enforcement are unchanged. Production synchronization/scheduling certification remains outside this task.

## Demonstrated defects and changes

| Before | After |
| --- | --- |
| Overview custom GET forms discarded unrelated/repeated parameters; invalid-range correction did too. Root alias discarded the range. | Both forms and `/` preserve query context; inclusive end-date and existing local half-open query semantics remain intact. |
| Failed Overview metrics removed all period controls despite available Library/status. | Period controls and each independently available section remain usable. |
| Reports replaced history, switched historical selections to the current clock, and its controlled numeric year input navigated on incomplete keystrokes. | Submitted period input supports editing/validation; frequency changes anchor to selected calendar identity and push history. Previous-period labels, report-to-recap links and CSV filenames identify the selected period. Existing CSV columns, local dates and per-session estimates are unchanged. Existing daily deep links now have a visibly selected Day control. |
| Activity accepted future month/day URLs while rendering those buttons disabled; pagination lost unrelated query parameters and linked to itself at boundaries. Empty copy claimed no reading. | Future selections normalize to local today/current month; today stays enabled; future calendar buttons stay disabled. Pagination preserves context and shows disabled boundary controls; successful empty copy says no imported sessions. Full-day totals remain independent of the 20-session visible page. |
| Status/author/type/size-only empty Library filters advised syncing; status `all` had no matching select option and “All statuss” was visible. Page metadata sums implied complete known size. | Every supported filter produces clear recovery; All statuses matches its actual value. Metadata sums are labeled Known. Library metadata dates explicitly use APP_TIMEZONE, independent of browser timezone. Out-of-range pages offer a first-page action preserving filters. Table rows retain their native semantics with actual keyboard title links and existing pointer row navigation. Existing sort order, filter contracts and 100-item pages are preserved. |
| Applying an author filter erased an unsubmitted search draft; separate blur navigations could prevent a combined search submission. | Each field synchronizes independently, and Search/Enter submits draft text, author and content type together while preserving other filters. |
| Article query failure surfaced a generic app error; an already decoded percent ID was decoded again. | Clear unavailable state with recovery copy and Library navigation; actual missing items still use 404; Next's decoded route ID is passed unchanged. |
| Account disclosure lacked Escape/outside dismissal and summary focus styling; Settings had no active indication. | Native disclosure preserves expanded semantics, closes on Escape/outside/route change and restores focus on Escape. Settings has `aria-current`/active styling; touched period/sort controls expose pressed state. Scroll padding keeps focused content clear of the fixed bottom bar. Logout still uses the same server action/form. Compatible Overview preset context continues through Activity; Reports’ distinct period vocabulary is excluded. Native article title links disable automatic prefetch to preserve the prior on-demand detail loading. |
| With 25 unlinked sessions, annual recap said no sessions synced and displayed zero articles; legacy rankings displayed zero/Unknown-author article attribution and promised more metadata syncing. | Recap narrative uses session count; attributed articles and item/source/author/tag panels state the unsupported capability. Legacy empty attribution hides misleading zero metrics while retaining linked-data rankings, searching and sorting. Small Library links make their purpose discoverable; the annual recap remains distinct and retains its selected report year. |
| Compact Overview status spread stream identifiers and dirty-rollup terminology. | Compact text uses reading sessions/library metadata/saved calculations; Settings retains exact diagnostics. Both use Task 21's unchanged shared interpretation, completion evidence and invocation/run correlation. |
| Production CSS pruned the existing dark palette; restoring it exposed low-contrast default chart text/tooltips, dark error text and pale light-theme Settings badges. | Retain the declared runtime theme, use its existing colors for chart labels/tooltips and status badges, and adjust semantic text tones for readable contrast. Compiled-CSS regression plus real browser scheme/contrast assertions protect this behavior. No theme switch or theme preference is introduced. |

## Synthetic browser matrix

The runner uses installed Chromium/Playwright with an isolated production Next server and loopback fake Data API. It replaces application configuration/credentials through the repository's `sanitizedEnvironment`, blocks external browser requests and rejects non-allowlisted fixture mutations. Only synthetic login/logout storage is mutable. It never invokes sync/continuation/history/repair controls. No new app dependency or test framework is installed; pinned Prettier is a task-local formatting tool only.

Original screenshots and machine-readable assertions are in [evidence/task22/completed](evidence/task22/completed/); `ui-validation.json` records the exact tested source SHA. The application tree remained unchanged through reviewed head `880fafb`; the Reports correction above has separate current-source evidence. Browser timezone is America/New_York; APP_TIMEZONE is Europe/Athens. Dark styling is exercised with the existing root `.dark` class; the application has no theme-switch preference control, and this task adds none.

| Route/control | Scenario | Viewport/input | Result / evidence |
| --- | --- | --- | --- |
| All implemented pages | Normal, nullable metadata, existing light/dark; overflow and final-control reachability | 390/768/1440; touch/mouse and keyboard | Pass: 66 normal route/theme cases and 66 scroll records; completed phase manifests and inspected screenshots. |
| Overview presets/custom | Presets, inclusive Through date, unrelated parameters, invalid range recovery, back/forward/reload | 390; browser forms/keyboard/pointer | Behavioral group plus Overview screenshots. |
| Activity calendar/sessions | Invalid/out-of-month/future URLs, local today, selected state, timestamp, month reset, two visible pages with invariant totals | 390; touch/keyboard | 25 one-second sessions total 100 words; visible page two has five rows. Athens 00:30 differs from browser local time. |
| Reports/date/CSV/recap | Selected 2025/2024 year, comparison year, period transitions, legacy weekStart and daily links, reload/history, downloaded CSV | 390; form/keyboard/pointer | CSV has header + 365 local dates, unchanged columns, local Jan 2 = 600s/2,250 words/one session. |
| Library/detail | Fixed ordering, 100+5 pagination, query+source+tag+status+author+type+size combination, filter-only empties, nullable metadata, browser back | All layout widths; 390 behavioral touch | Regression runner and representative table/card/detail screenshots. |
| Account/navigation | Visible primary active route; Settings current; native expanded state; Tab Settings→logout; Escape focus return; outside dismissal | Each width/theme; keyboard and touch/mouse | Behavioral groups; logout is checked only against synthetic storage. |
| Overview/Settings | Never completed, historical time unknown, successful empty, partial/pending, stale completion, sessions complete/metadata incomplete, pending persisted work, unapplied candidate | 390/768/1440 | Shared Task 21 interpretation; no completeness or successful scheduling inferred. |
| Independent failures | Metrics vs Library vs completion status; Library/detail outage; Activity/Reports/recap serving query failure | 390/768/1440 where applicable | Pass: unavailable stays unavailable; other sections remain visible. Supplemental closer view shows the actual error, period controls and available Library. |
| Login/logout | Required label, incorrect password, retryable outage, valid login, cookie removal and rejected replay | 390; keyboard/forms | Actual existing actions against synthetic auth rows only. |

Original browser outcome: **five successful phases, 159 rendered page/state checks (153 distinct recorded combinations), 21 behavioral groups, 66 scroll-reachability records, and 30 measured text-contrast checks (minimum 5.4:1)**. Thirty phase screenshots plus two supplemental closer views were captured. Representative actual images were visually inspected; [the evidence guide](evidence/task22/README.md) links them. All phase manifests report zero page errors, external browser requests, unexpected mutations and Library detail prefetches. Completed phases observed zero browser console/resource failures; the runner retains its narrow pre-existing favicon-404 allowance if encountered.

## Original validation and evidence provenance

Application/build source: `877fae00126141b60fc7a60f6690c8f02a9cab22`. Browser harness source: `9097b2298f3a4641b97a2d81bcae3e644e76fc64`. The harness verifies that app/components/lib, dependency files and theme configuration have no differences from the build source before starting. Evidence/documentation commits through reviewed head `880fafb` did not alter that application tree; the Reports correction above supersedes its reference-handling evidence. Final PR-head checks are linked and reported in the PR; an earlier CI run is never substituted for that head.

| Validation | Result at application source |
| --- | --- |
| `npm ci --cache work/npm-cache` | Passed; 456 locked packages; dependency files unchanged |
| `npx --no-install next typegen` then `npm run typecheck` | Passed sequentially |
| `npm run lint` | Passed, zero errors; three pre-existing warnings in local `.agents/skills/visual-explainer` files |
| Test compilation and focused regression suite | Passed: 20 tests, zero failed/cancelled/skipped |
| `npm run build` with synthetic configuration | Passed; all routes generated; non-blocking Webpack cache-size warnings |
| `git diff --check` and forbidden-boundary diff | Passed; no migrations, policy/auth/metrics/ingestion/dependency/workflow changes |
| Completed pre-interruption full application unit run | 384 passed, zero failed/cancelled/skipped; compiled source `96cf5adae4d8951e889e9ea1d93cdbba49ae1774`. Retained only for unchanged code; current focused/browser checks cover subsequent navigation/prefetch edits, and final-head CI reruns the full suite. |
| Latest `npm run audit:ci` | **Failed (exit 1)**: policy reports a compatible remediation for `tailwindcss-animate`, expiring `GHSA-vfj7-8cjw-p6xm`'s existing development-only exception. Full report: eight high development finding entries; production: zero vulnerabilities. Earlier seven-entry passes are superseded. No dependency or policy change is made. |
| Local opt-in disposable database suite | Not enabled; not counted as a pass. The unchanged final-head CI fresh/upgrade job is reported separately. |

[Command exit/timing records](evidence/task22/validation-commands.json), [sanitized command output](evidence/task22/validation-output.txt), [full audit](evidence/task22/audit-full.json) and [production audit](evidence/task22/audit-production.json) preserve the results. Local tooling: Node 24.19.0, npm 11.9.0, Chromium 151.0.7922.173 on Debian 13; existing CI uses Node 22. The failed audit remains enforced and is a release gate requiring a separately reviewed dependency-baseline decision; Task 22 explicitly excludes upgrades and policy relaxation.

Failed/interrupted development attempts are excluded from passed results. These included type generation before installation completed; an initially incompatible generated PageProps signature; missing fixture compilation/imports; refusal of named read-only RPCs; a concurrent build replacing generated type files; and browser assertions before streamed detail content or held-login responses settled. The final sign-in retry now refills the password after React resets the returned uncontrolled action form. No authentication implementation changed. A full browser attempt at the build source timed out during desktop dark scroll inspection; the same eleven-route sequence passed in isolation. Fresh-process layout/flow/state phases retain all original assertions and 30-second timeouts and produce separately complete manifests. Interrupted root/`final`/`verified` screenshots are preserved untracked in the workspace and excluded from the final evidence. The existing favicon-404 allowance is unchanged; no console/resource failures occurred in completed phases.

Reproduction:

```sh
npm ci --cache work/npm-cache
npx --no-install next typegen
npm run typecheck
npm run lint
npm run test
npm run build
npm run audit:ci
git diff --check
export TASK22_PLAYWRIGHT_MODULE=/opt/codex/runtimes/cua/lib/node_modules/playwright/index.mjs
export TASK22_BUILD_SOURCE_SHA="$(git rev-parse HEAD)"
# Use new output directories when reproducing, preserving committed evidence.
for width in 390 768 1440; do
  TASK22_PHASE=layout TASK22_WIDTH=$width TASK22_EVIDENCE_DIR=work/task22-rerun/layout-$width node scripts/task22-ui-verify.mjs || exit
done
TASK22_PHASE=flows TASK22_EVIDENCE_DIR=work/task22-rerun/flows node scripts/task22-ui-verify.mjs
TASK22_PHASE=states TASK22_EVIDENCE_DIR=work/task22-rerun/states node scripts/task22-ui-verify.mjs
```

Build/browser use synthetic server configuration; never substitute production values to reproduce screenshots. Existing tests cover canonical estimates, local periods/comparisons/CSV, complete inputs and bounded client payloads. New behavioral regression tests exercise actual presentation handlers/server pages and future Activity parameters; browser tests exercise actual forms, history, menu and pagination. No ingestion/security suite is duplicated or enforcement weakened.

The completed manifest reports final browser counts and scope; representative images are visually inspected, including keyboard focus, horizontal table access, account placement, chart contrast, partial status and independent metric failure. This is Chromium keyboard/touch/browser QA, not a screen-reader audit, cross-engine/mobile-hardware certification or production synchronization proof. Dark styling uses the already declared root class; no theme preference control is added.

## Compatibility, rollback and external gates

No schema/migration, dependency/lockfile, RLS/grant, auth/session policy, metric formula, calendar method, pagination size, sync quota/budget/cadence, retry/checkpoint/continuation, generation or Task 21 evidence contract changes. A compatible application-only rollback to the base restores the previous UI defects; leave all installed migrations, synchronization progress/checkpoints and status/generation evidence intact. No data rollback, reset, repair or redeployment is performed by this task. Existing Task 20/21 operational compatibility requirements continue to apply.

The user reports applying Task 21's migration and deploying. The reported manual invocation imported 200 sessions, reached its page budget and retained its checkpoint. This task does not verify production deployment/migrations/configuration, historical upstream coverage, scheduled delivery/continuation, production query performance or actual Matter payload capability. Synthetic completed/partial/error states are UI evidence only. Task 23 runbook and Task 24 staging/release certification remain separate; no manual deployment or merge is performed.
