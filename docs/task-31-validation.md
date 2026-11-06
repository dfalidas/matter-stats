# Task 31 — preparation validation and handoff

Task 31 is **awaiting usage findings**, not implemented or production-accepted.
See [evidence assessment, provisional cards and diary](task-31-mobile-usage.md).
No candidate has been selected. This draft changes documentation and synthetic
inspection evidence only. There is no before/after UI pair because application
code is unchanged; screenshots are **current-baseline** evidence only.

## Identity and local checks

Fetched base and actual executable source tested locally:
`2054aa821f399b4c3073e4147fb78c49a4631352` (Task 30 / merged PR #95).
Local tracked runtime files remained identical throughout. The PR head contains documentation/evidence only; the PR body records that
exact head and its independently observed CI status. Local baseline results must not be labeled head CI.

Toolchain: Node **22.23.4**, npm **10.9.10**, lockfile-installed Playwright **1.64.1**.
Repository pins Node 22.x and dependencies through `package-lock.json`; no new
package version or toolchain file was introduced. Default host Node 24/npm 11
was not used for the application checks. Real runtime credentials were removed
from subprocess environments; UI uses only the existing loopback synthetic Data
API with explicit fake credentials and Europe/Athens. No `.env.local` exists.

| Check | Actual result |
| --- | --- |
| `npm ci` | PASS, exact lockfile, 348 packages installed; package/lockfile unchanged |
| `npx --no-install next typegen` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS; three existing skill-directory warnings (two ESLint, one Oxlint), no errors |
| `npm run test` | PASS, 447/447, fail/cancelled/skipped/TODO 0. Disposable DB opt-in was not enabled; this is not a local database pass |
| `npm run build` | PASS, production compilation/type checks/static generation |
| `npm run audit:ci` | PASS, full audit 0 findings / production 0 vulnerabilities |
| `git diff --check` | PASS for preparation files; repeated before commit |
| New unit tests | Not added: documentation-only preparation has no new runtime behavior |
| Local isolated database/full-stack suites | Not run; no database/runtime change. Existing three CI jobs/security/database gates are unchanged and run on the draft |
| Production, real Matter, personal goals | Not run; no sync/import/cron, migration, reset/repair, production write, manual deployment or merge |

## Browser scope and reproducibility

Use the checked-in Task 22 synthetic Data API and capped PostgREST fixture against
the unchanged production build, not production or a real Supabase endpoint.
The scratch fixture adds only two in-memory synthetic enabled goals for the current
calendar week/year (2h/20h), with period starts from the existing calendar helper.
This allows goal labels/progress/edit controls to be inspected without saving.
It is not a real goal mutation. All app server configuration is replaced with
loopback/fake values; browser network is restricted to loopback. No ingestion
control or goal Save/Disable is activated. Automatic read-only sync-availability
server actions operate against that same synthetic fixture.

The [inspection driver](evidence/task31/inspect.mjs.txt) and
[reproduction instructions](evidence/task31/README.md) describe the actual setup.
The machine-readable [inspection](evidence/task31/inspection.json) records browser
versions, UA, viewport, theme, overflow, control bounds and flow observations.
These observations establish only behavior in synthetic inspection, **not**
real-usage frequency, practical impact, production correctness or completion of
the agreed observation period.

Actual iPhone Safari: **not available / not run**. No connected physical iPhone
was provided. WebKit: launch attempted, blocked by missing Linux shared libraries;
`playwright install-deps webkit` could not elevate (su authentication failure).
No WebKit emulation pass is claimed. A 390px Chromium touch viewport is an
**emulated viewport**, not iPhone Safari.

## Remaining acceptance, impact and rollback

Before selecting improvements: actual 1–2 week diary, device/browser and text-size
context where known, reproducible difficulty, impact/frequency, and a ranked list
of zero to three supported changes. Then capture paired before/after narrow,
iPhone-sized and desktop evidence, both themes, and test the affected flows,
keyboard/focus, touch spacing, error/empty states and bottom safe-area reachability.
Physical Safari validation and production review remain separate gates.

Data/schema/dependencies/configuration: **no change**. Task 29 goals, Task 30
monthly behavior, CSV/URLs/timezone, auth and sync eligibility/checkpoints remain
unchanged. Tasks 26–28 and 32 remain separate. Rollback: close this unmerged draft
or revert documentation; no data rollback, migration or deployment is necessary.

## Current-baseline inspection findings (6 November 2026)

Chromium **156.0.8078.4**, Playwright **1.64.1**, Linux headless; 320×844 and
390×844 touch/mobile contexts and 1440×1000 desktop, each light/dark.
The actual UA and each result are retained in JSON; no physical device is implied.

| Observation | Reproduction and result | Interpretation / limit |
| --- | --- | --- |
| Page width | Load Overview (`period=month`), Reports (`period=monthly&date=2026-09`) and Settings at each width/theme; document/body scrollWidth equals viewport width | No page-level horizontal overflow in these sampled states, not all data/font-size/device combinations |
| Period controls | Reports: fill August 2026 and Apply; URL and input retain `2026-08` | Current selection flow works in sampled Chromium contexts; no evidence of real tap mistakes or discovery difficulty |
| Goals | Current weekly/yearly synthetic enabled goals; open first Edit, focus labeled weekly hours input, Close without saving | Current labels, target/progress/date/coverage presentation can be inspected; no personal goal or persistence mutation |
| Account | At mobile widths open Account, observe Settings and Log out, Escape restores focus to Account | Access exists and focus restoration works in this synthetic check; not a user discovery-time study |
| Touch-size candidate | Settings → Matter sync health → inspect Sync Recent Activity, Start / Resume Session History, Backfill Library; each measured **36px high** in all sampled layouts (Settings Logout also 36px) | Browser-only finding, below Task 25's 44px design target; no observed user miss/impact/frequency. **Not selected or fixed** without the usage evidence gate |
| Content length | Goal/review sections require vertical scrolling on narrow screens; normal wrapping and mobile bottom navigation are visible | Vertical scrolling alone does not establish friction or inaccessible content; enlarged OS text and physical safe areas remain unverified |

The 36px observation's source is this dated synthetic inspection, not the user.
To assess it, diary entries should identify actual missed taps or spacing problems,
device/browser/text settings, steps and frequency. If selected later, increase the
specific action's usable touch area/spacing to at least 44px while preserving all
existing disabled/eligibility states and server authorization/checkpoints; verify
touch, keyboard, both themes and safe-area reachability on the affected device.
No action is invoked to investigate this candidate.

Baseline captures cover page entry, goals, monthly summary and sync controls.
They include synthetic empty historical monthly data and current goals, not a
complete populated/current/future/error-state acceptance matrix. Historical
Task 30 validation remains separately dated. Browser errors and unexpected
external requests are recorded in JSON; only completed runs are counted.
No CSS-only tests or new runtime regression tests were added.

All 36 current-baseline light/dark screenshots were visually reviewed in six
contact sheets, with representative originals inspected at full size for goal
values, monthly summary and sync controls. No clipped text was found in these
captures. The dark Settings status-badge text looks faint; contrast was not
measured and remains a follow-up inspection question, not an established user
difficulty or selected improvement. Content in a scrolled viewport can pass behind the fixed bottom bar;
this alone is not a failure because it can scroll further. The app retains its
112px mobile main bottom padding and safe-area bottom-bar rule. The inspection
records final control bounds after scrolling to the end; physical iPhone safe-area
and OS text scaling still need device validation. No full accessibility or Safari
certification is claimed.

Final browser result: **6 completed Chromium viewport/theme contexts, 18 page
visits, 36 screenshots, zero page errors and zero unexpected external browser
requests**. WebKit launch separately blocked. At mobile page end, the final
Overview/Settings controls were above the bottom navigation (731px/707px vs
787.5px navigation top). Reports last interactive link can scroll above the
viewport at page end; it remains reachable earlier in the page. This is not a
physical safe-area certification. Owned app/fixture processes were stopped after
capture. [Sanitized local check ledger](evidence/task31/local-checks.json).
