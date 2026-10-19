# Task 22 / H3 / W7 / R10 focused UI QA

Base: `300cf87cfa7454597e59a1619bcedc4da9af3681` (fetched main; no subsequent changes). Scope is presentation, route/input handling, directly necessary error mapping, regression tests and synthetic evidence. [Route inventory](task-22-route-inventory.md) records pre-edit behavior, guards, useful functions and dispositions. All useful secondary routes are retained.

## Recovery assessment

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

Final screenshots and machine-readable assertions are in [evidence/task22/completed](evidence/task22/completed/); `ui-validation.json` records the exact tested source SHA. The final application tree is unchanged after the photographed source; later verification/documentation commits are distinguished from the screenshot source and final PR head below. Browser timezone is America/New_York; APP_TIMEZONE is Europe/Athens. Dark styling is exercised with the existing root `.dark` class; the application has no theme-switch preference control, and this task adds none.

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

Final browser outcome: **five successful phases, 159 rendered page/state checks (153 distinct recorded combinations), 21 behavioral groups, 66 scroll-reachability records, and 30 measured text-contrast checks (minimum 5.4:1)**. Thirty phase screenshots plus two supplemental closer views were captured. Representative actual images were visually inspected; [the evidence guide](evidence/task22/README.md) links them. All phase manifests report zero page errors, external browser requests, unexpected mutations and Library detail prefetches. Completed phases observed zero browser console/resource failures; the runner retains its narrow pre-existing favicon-404 allowance if encountered.

## Validation and evidence provenance

Application/build source: `877fae00126141b60fc7a60f6690c8f02a9cab22`. Browser harness source: `9097b2298f3a4641b97a2d81bcae3e644e76fc64`. The harness verifies that app/components/lib, dependency files and theme configuration have no differences from the build source before starting. Later evidence/documentation changes do not alter that application tree. Final PR-head checks are linked and reported in the PR; an earlier CI run is never substituted for that head.

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
export TASK22_BUILD_SOURCE_SHA=877fae00126141b60fc7a60f6690c8f02a9cab22
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
