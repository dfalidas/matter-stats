# Task 31 — mobile preparation and usage evidence

Status on **6 November 2026 (Europe/Athens): awaiting usage findings**.
No improvements selected and no application changes implemented. This is the
preparation path specified by Action Plan v2.1, not completion or production
acceptance of Task 31. The 1–2 week observation period is **not established** by
the available evidence. A calendar interval since an earlier task is not a usage log.

## Baseline and sources reviewed

Fetched `origin/main` is `2054aa821f399b4c3073e4147fb78c49a4631352`, exactly
PR #95's merge commit (GitHub confirms MERGED, 6 November 2026 15:49:05 Athens).
Created `task-31-mobile-usage-evidence` from that commit with a clean tracked tree.
Task 29 goals and Task 30 monthly Reports are present. This task leaves both intact.

Reviewed repository-wide `AGENTS.md`, CI, architecture, Task 25 backlog/product
specification, Task 22 mobile validation/route inventory, Task 29 and 30 operator
and validation reports, and the current Overview/goals, Reports, Account/navigation,
Settings and sync-control implementations. Sources of usage evidence were:

| Source and observation date | What it actually establishes | Missing for mobile selection |
| --- | --- | --- |
| Craft **Matter Stats — Project Log & Action Plan**, document `50ffc904-165e-f3db-94e8-0a465f82eef0`; Action Plan v2.1 child `b41a47db-296b-61cf-129b-b5c1ac90d475`, read 6 Nov | Task 31 requires 1–2 weeks of practical observations and selection of at most three issues; latest 6 Nov entry still calls for that collection | Dated difficulties, frequency, affected devices and impact |
| Craft 6 Nov Task 29 “οκ, δουλεύει” and Task 30 “οκ φαίνεται” | User confirms goal operation / monthly-review appearance respectively | Neither describes mobile friction; device/browser unknown |
| Craft 31 Oct IMG_3024/IMG_3023 notes and subsequent import-status notes | Status/count/checkpoint evidence for Task 26; operational recovery discussion | No reported mobile discovery failure or usability reproduction; device/browser unknown. Original images were not available for new visual inspection |
| Repository Task 25 spec/backlog (existing proposals, inspected 6 Nov) | Three provisional candidate areas and evidence needed | Proposals are not user reports |
| Task 22/29/30 synthetic browser reports, historical dates retained in those reports | Prior implementation and synthetic validation, including Task 30's resolved cramped trend columns | Not real usage and not proof of an observation period |
| GitHub issues (all states, none returned), PR #94/#95 comments/reviews, recent PR descriptions, inspected 6 Nov | Deployment/review notes; no additional mobile difficulty diary found | No independent record qualifying a candidate for selection |

This is a statement about reviewed sources, not a claim that the user has never
experienced a difficulty. No feedback, device identity or observation date is inferred.

## Current flow inventory and provisional investigation cards

All cards below are **questions to observe**, not user-reported defects. Proposed
changes are conditional options only. Selection remains **0 of at most 3**.
A synthetic-only 36px sync-action height observation is recorded; its actual user impact remains unknown. Synthetic browser findings and their narrower conclusions are recorded separately
in [validation](task-31-validation.md).

### P1 — choosing a period

Source/date: provisional Task 25 specification and Craft Task 31; inspected 6 Nov.
Device/browser for an actual difficulty: **unknown / no report**.

Reproduce the workflow: Overview → choose Month or Custom → enter dates → Apply;
Reports → Month → Specific report period → Apply period → switch Week/Year and
return. Include a December/January boundary and browser Back/reload. Record the
intended period, taps/backtracks, wrong selections and eventual result.

Practical impact to establish: how often selection is slow or wrong, and whether
period/year labels prevent recovery. Conditional change: simplify the existing
period/reference controls if the diary identifies a specific repeated difficulty.
Acceptance if selected: user can select the intended period and explain its label;
controls are reachable with touch and keyboard at the affected width, without
page overflow; URL/reference, unrelated query state, Back/reload and full-period
CSV identity stay correct. Quantify tap reduction against the recorded baseline.

### P2 — reading goals and monthly review

Source/date: provisional Task 25 specification and Craft Task 31; inspected 6 Nov.
Device/browser for an actual difficulty: **unknown / no report**.

Workflow: Overview → Reading goals → read weekly/yearly target, actual, remainder,
pacing, period dates and coverage; open Edit then Close without saving. Reports →
closed Month → read totals, time/active day, comparison, coverage and year trend;
inspect current, empty and unavailable states. Record actual phone/font settings
and the exact label/value that could not be read or was misunderstood.

Practical impact to establish: missed dates/denominators, truncation, unwanted
scrolling or mistaken interpretation. Conditional change: adjust stacking or
spacing of the specific affected values. Acceptance if selected: labels, dates,
values and caveats are readable at the observed text size in both themes; no
clipped content/page overflow, reachable controls, unchanged goal CRUD semantics,
monthly comparisons, canonical metrics and Europe/Athens boundaries.

### P3 — finding sync controls and understanding status

Source/date: provisional Task 25 specification and Craft Task 31. The 31 Oct
operational status notes do not establish a mobile usability issue.
Device/browser for an actual difficulty: **unknown / no report**.

Workflow: from any primary tab → Account → Settings → locate Start / Resume
Session History and independent sync/coverage evidence. Observe labels and
eligibility without starting an import for this investigation. Record discovery
time, wrong paths, the status misunderstood and any attempted duplicate action.

Practical impact to establish: inability to find the existing action or distinguish
partial/pause/completion. Conditional change: clarify the existing Settings entry
or presentation of action/status after the exact confusion is known. Acceptance
if selected: user finds the intended existing action and explains the displayed
state; disabled/cooldown/error states remain readable and accessible; server
authorization, eligibility, checkpoint behavior and every sync contract are retained.

## Short real-usage diary template

Keep personal reading details and private screenshots outside the public PR.
Record successful attempts as well as difficulties, so frequency has a denominator.
Do not trigger extra imports, cron invocations or personal-goal edits for the diary.

| Observation date/time (Athens) | Device, OS, browser/version; viewport, orientation, text size | Intended task and starting page/state | Steps / taps / backtracks | Expected vs actual; exact label | Impact, workaround, repeat count / attempts | Private evidence reference |
| --- | --- | --- | --- | --- | --- | --- |
| _Fill during actual use_ | _Unknown fields stay unknown_ | _Period/status without personal records_ | _Numbered steps_ | _Describe the difficulty_ | _Blocked / wrong result / time lost / cosmetic_ | _Optional redacted screenshot_ |

Observation window: start **not yet documented**; end **not yet documented**.
A useful handoff includes 1–2 weeks of dated actual use, known device/browser for
each issue where possible, reproducible steps, frequency and practical impact.
An isolated severe incident may be recorded immediately; it does not establish
that the agreed observation period has been completed.

After collection: group duplicates, reproduce on synthetic fixtures, rank by
practical impact and frequency, then select **zero to three**. Each selected
issue must cite its diary rows, describe the concrete change and observable
acceptance criteria. No routine implementation approval is needed once this
evidence supports work within the already authorized boundaries.

## Scope, remaining gates and rollback

Preserve four tabs, Account/Settings/logout, visual language, both themes,
URLs/filter/period state, pagination, CSV, metrics and coverage. No sync logic,
quotas, retries, schedules, cursors, generations, auth/security, schema, dependencies
or runtime configuration change. Tasks 26–28 and 32 remain separate.

Next gate is the actual usage diary, then evidence-based selection. Any later UI
change needs paired before/after captures at narrow mobile, representative iPhone
and desktop, light/dark, touch/focus/keyboard/error/empty/safe-area checks and
appropriate behavioral regression coverage. Actual iPhone Safari remains a
separate device check; WebKit emulation cannot certify it. User review and
production verification are still required before production acceptance.

This preparation is documentation-only. Rollback is to close the unmerged draft
or revert its documentation commit; no migration, data rollback or deployment.
