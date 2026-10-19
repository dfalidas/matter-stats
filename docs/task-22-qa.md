# Task 22 / H3 / W7 / R10 focused UI QA

Base: `300cf87cfa7454597e59a1619bcedc4da9af3681` (fetched main; no subsequent changes). Scope is presentation, route/input handling, directly necessary error mapping, regression tests and synthetic evidence. [Route inventory](task-22-route-inventory.md) records pre-edit behavior, guards, useful functions and dispositions. All useful secondary routes are retained.

## Demonstrated defects and changes

| Before | After |
| --- | --- |
| Overview custom GET forms discarded unrelated/repeated parameters; invalid-range correction did too. Root alias discarded the range. | Both forms and `/` preserve query context; inclusive end-date and existing local half-open query semantics remain intact. |
| Failed Overview metrics removed all period controls despite available Library/status. | Period controls and each independently available section remain usable. |
| Reports replaced history, switched historical selections to the current clock, and its controlled numeric year input navigated on incomplete keystrokes. | Submitted period input supports editing/validation; frequency changes anchor to selected calendar identity and push history. Previous-period labels, report-to-recap links and CSV filenames identify the selected period. Existing CSV columns, local dates and per-session estimates are unchanged. Existing daily deep links now have a visibly selected Day control. |
| Activity accepted future month/day URLs while rendering those buttons disabled; pagination lost unrelated query parameters and linked to itself at boundaries. Empty copy claimed no reading. | Future selections normalize to local today/current month; today stays enabled; future calendar buttons stay disabled. Pagination preserves context and shows disabled boundary controls; successful empty copy says no imported sessions. Full-day totals remain independent of the 20-session visible page. |
| Status/author/type/size-only empty Library filters advised syncing; status `all` had no matching select option and “All statuss” was visible. Page metadata sums implied complete known size. | Every supported filter produces clear recovery; All statuses matches its actual value. Metadata sums are labeled Known. Library metadata dates explicitly use APP_TIMEZONE, independent of browser timezone. Existing sort order, filter contracts and 100-item pages are preserved. |
| Article query failure surfaced a generic app error; an already decoded percent ID was decoded again. | Clear unavailable state with recovery copy and Library navigation; actual missing items still use 404; Next's decoded route ID is passed unchanged. |
| Account disclosure lacked Escape/outside dismissal and summary focus styling; Settings had no active indication. | Native disclosure preserves expanded semantics, closes on Escape/outside/route change and restores focus on Escape. Settings has `aria-current`/active styling; touched period/sort controls expose pressed state. Scroll padding keeps focused content clear of the fixed bottom bar. Logout still uses the same server action/form. |
| With 25 unlinked sessions, annual recap said no sessions synced and displayed zero articles; legacy rankings displayed zero/Unknown-author article attribution and promised more metadata syncing. | Recap narrative uses session count; attributed articles and item/source/author/tag panels state the unsupported capability. Legacy empty attribution hides misleading zero metrics while retaining linked-data rankings, searching and sorting. Small Library links make their purpose discoverable; the annual recap remains distinct and retains its selected report year. |
| Compact Overview status spread stream identifiers and dirty-rollup terminology. | Compact text uses reading sessions/library metadata/saved calculations; Settings retains exact diagnostics. Both use Task 21's unchanged shared interpretation, completion evidence and invocation/run correlation. |

## Synthetic browser matrix

The runner uses installed Chromium/Playwright with an isolated production Next server and loopback fake Data API. It replaces application configuration/credentials through the repository's `sanitizedEnvironment`, blocks external browser requests and rejects non-allowlisted fixture mutations. Only synthetic login/logout storage is mutable. It never invokes sync/continuation/history/repair controls. No new app dependency or test framework is installed; pinned Prettier is a task-local formatting tool only.

Screenshots and machine-readable assertions are in [evidence/task22](evidence/task22/); `ui-validation.json` records the exact tested source SHA. The final evidence commit changes documentation/images only; screenshot source and final PR head are distinguished in validation below. Browser timezone is America/New_York; APP_TIMEZONE is Europe/Athens. Dark styling is exercised with the existing root `.dark` class; the application has no theme-switch preference control, and this task adds none.

| Route/control | Scenario | Viewport/input | Result / evidence |
| --- | --- | --- | --- |
| All implemented pages | Normal, nullable metadata, existing light/dark; overflow and final-control reachability | 390/768/1440; touch/mouse and keyboard | See per-page entries and screenshots in `ui-validation.json`; visually inspected representative renders. |
| Overview presets/custom | Presets, inclusive Through date, unrelated parameters, invalid range recovery, back/forward/reload | 390; browser forms/keyboard/pointer | Behavioral group plus Overview screenshots. |
| Activity calendar/sessions | Invalid/out-of-month/future URLs, local today, selected state, timestamp, month reset, two visible pages with invariant totals | 390; touch/keyboard | 25 one-second sessions total 100 words; visible page two has five rows. Athens 00:30 differs from browser local time. |
| Reports/date/CSV/recap | Selected 2025/2024 year, comparison year, period transitions, legacy weekStart and daily links, reload/history, downloaded CSV | 390; form/keyboard/pointer | CSV has header + 365 local dates, unchanged columns, local Jan 2 = 600s/2,250 words/one session. |
| Library/detail | Fixed ordering, 100+5 pagination, query+source+tag+status+author+type+size combination, filter-only empties, nullable metadata, browser back | All layout widths; 390 behavioral touch | Regression runner and representative table/card/detail screenshots. |
| Account/navigation | Visible primary active route; Settings current; native expanded state; Tab Settings→logout; Escape focus return; outside dismissal | Each width/theme; keyboard and touch/mouse | Behavioral groups; logout is checked only against synthetic storage. |
| Overview/Settings | Never completed, historical time unknown, successful empty, partial/pending, stale completion, sessions complete/metadata incomplete, pending persisted work, unapplied candidate | 390/768/1440 | Shared Task 21 interpretation; no completeness or successful scheduling inferred. |
| Independent failures | Metrics vs Library vs completion status; Library/detail outage; Activity/Reports/recap serving query failure | 390/768/1440 where applicable | Unavailable stays unavailable; other available sections remain visible. |
| Login/logout | Required label, incorrect password, retryable outage, valid login, cookie removal and rejected replay | 390; keyboard/forms | Actual existing actions against synthetic auth rows only. |

## Validation and evidence provenance

Final commands, counts, exact source/head SHAs and CI results are recorded after execution. Initial attempts are not counted as successful checks: type generation raced the still-running locked installation (`next` not yet present); the initial recap signature used an optional default incompatible with Next's generated PageProps; and the first regression invocation omitted compilation of AppNavigation. Those setup/signature/fixture issues were corrected and required checks rerun. Initial synthetic fixture mutation refusal also blocked read-only POST RPCs; the fixture was corrected to allow only named read RPCs before final status evidence.

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
TASK22_PLAYWRIGHT_MODULE=/opt/codex/runtimes/cua/lib/node_modules/playwright/index.mjs node scripts/task22-ui-verify.mjs
```

Build/browser use synthetic server configuration; never substitute production values to reproduce screenshots. Existing tests cover canonical estimates, local periods/comparisons/CSV, complete inputs and bounded client payloads. New behavioral regression tests exercise actual presentation handlers/server pages and future Activity parameters; browser tests exercise actual forms, history, menu and pagination. No ingestion/security suite is duplicated or enforcement weakened.

## Compatibility, rollback and external gates

No schema/migration, dependency/lockfile, RLS/grant, auth/session policy, metric formula, calendar method, pagination size, sync quota/budget/cadence, retry/checkpoint/continuation, generation or Task 21 evidence contract changes. A compatible application-only rollback to the base restores the previous UI defects; leave all installed migrations, synchronization progress/checkpoints and status/generation evidence intact. No data rollback, reset, repair or redeployment is performed by this task. Existing Task 20/21 operational compatibility requirements continue to apply.

The user reports applying Task 21's migration and deploying. The reported manual invocation imported 200 sessions, reached its page budget and retained its checkpoint. This task does not verify production deployment/migrations/configuration, historical upstream coverage, scheduled delivery/continuation, production query performance or actual Matter payload capability. Synthetic completed/partial/error states are UI evidence only. Task 23 runbook and Task 24 staging/release certification remain separate; no manual deployment or merge is performed.
