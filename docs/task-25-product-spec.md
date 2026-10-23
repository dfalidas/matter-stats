# v2.1 product specification — Tasks 29–31

Status: requirements baseline ready for review, **not implemented**. The approved plan establishes optional weekly/yearly hour goals, monthly review and evidence-led mobile work. Detailed choices marked **proposed** below are reviewable product decisions, not verified existing behavior. [Static mockups](task25/mockups.html) contain synthetic examples only.

## Verified existing foundation

Overview already presents canonical time, estimated words, active days and sessions, rhythm/weekday charts, status and library preview. Reports already presents those four totals, review prose, full calendar periods, comparison identity, period/reference controls, session histogram, weekday chart, annual recap link and CSV. Monthly time chart currently groups daily heatmap values into week buckets. Settings already provides sync/status controls; the shell has four primary tabs and Account menu. See [baseline sources](task-25-baseline.md).

Use the application's validated `APP_TIMEZONE`, default **Europe/Athens**, never browser/host timezone. Reuse `lib/calendar.ts`, metrics/report range helpers and `lib/reading-estimates.ts`; capture one request `now`. Whole sessions belong to the local date of `started_at`, with no inferred interval splitting. Boundaries are **[start, end)** local midnights converted independently to UTC, not fixed 24-hour additions. Weeks start Monday; years are January 1 through next January 1. A week crossing New Year is keyed by its Monday date, not the calendar year containing today.

For a successfully read period: `S = sum(canonical duration seconds)`, `N = imported session count`, `W = sum(Math.round(duration_seconds / 60 * 225))` **individually per session**, `A = number of local dates with daily S > 0`. Valid zero-duration sessions count in N, not A. Existing metric normalization is preserved; newly discovered invalid stored inputs are separately flagged, not silently repaired by this feature. Article `word_count` never enters W. Use unrounded seconds for all arithmetic and comparisons.

**Proposed display convention for new values:** time to nearest minute, but positive values below 30 seconds show `<1 min` rather than zero; hours/minutes for longer totals; percent to one decimal, trailing `.0` optional. Average session length in observations uses minutes to one decimal so small differences remain legible. Never round individual durations before summing. Estimated words are integers with `≈` and 225 WPM note. Ratios use exact inputs before display rounding. Read failures are “Unavailable”, never zero. Coverage states distinguish in-progress import / incomplete or unknown history / successful stored-input reads. Enumeration exhaustion does not remove the unverified upstream-history caveat.

## Task 29 — optional goals

**Proposed placement:** one compact “Reading goals” section in Overview after the existing totals, before charts. Two rows for **current calendar week** and **current calendar year**, each explicitly labeled with its own dates/timezone. They remain current-period goals when Overview's analytics filter changes, preventing a selected historical/custom period from silently changing the goal denominator. Historical goal review is available through a period chooser inside this section; it does not add navigation or another totals card. Create/edit/disable use a small inline form with keyboard focus and save/cancel feedback. No Settings duplicate.

**Proposed lifecycle:** no prefilled numeric target, no silent enablement and no automatic carry-forward. “No goal set — Set a weekly/yearly goal” is the initial state. Accept hours >0, at most two decimal places; reject blank/nonfinite/negative/zero input, explaining that Disable is separate. Parse decimal text to integer hundredths of an hour and multiply by 36 seconds; reject values outside safe exact integer arithmetic. Do not invent a personal maximum or target. Disabling preserves the period's value/state for history and hides attainment/pacing until explicitly re-enabled; editing it re-enables only through an explicit save labeled accordingly.

Logical persisted record: type (`weekly`/`yearly`), local period start/exclusive end, validated timezone, target seconds, enabled state and update metadata. One record per type/calendar period; concurrent creation must not duplicate it. Server-side authorized writes and reads survive reload and new sessions/devices. Storage design and any migration belong to Task 29. Editing only affects that identified period, never earlier periods; closed periods are read-only in this first version. Historical actuals may change when newly imported sessions arrive; the recorded historical target does not. At rollover there is a new empty period. Save errors retain entered text without claiming persistence. APP_TIMEZONE changes must not relabel old goals: retain their original zone/boundaries and require explicit handling before using a goal in the new zone.

For goal G seconds in `[B,E)` and captured instant t:

- `actual = S` for raw sessions with `B <= started_at < min(t,E)` (zero before B). Historic expired goal uses its whole period. Flag anomalous future records instead of including them in progress.
- `attainment = 100 * actual / G`; numeric label can exceed 100%; visual bar clamps to [0,100].
- `remaining = max(G - actual, 0)`; show “Goal reached” and optional excess time after attainment.
- **Proposed pace denominator:** local calendar days remaining, with the current day's remaining fraction. For current local day `[D,Dnext)`, `d = calendarDateDifference(D,E) - (t-D)/(Dnext-D)`; clamp to [0, period day count]. At/before B use the full count; at/after E use 0. DST uses the actual 23/24/25-hour current-day span, while later days count as calendar days.
- `requiredAverageSecondsPerDay = remaining / d` when `d>0`. Display rounded **up** to whole minutes/day when positive, 0 when achieved. Label “Average needed per remaining day (including rest of today)”; this is a required pace, not a prediction. Never divide by days already elapsed or by active days.

| State | Required behavior |
| --- | --- |
| No goal / disabled | Show current actual optionally, with a distinct “No goal” / “Disabled” label; no percent or pace; explicit create/re-enable affordance |
| Zero activity with enabled goal | 0% and full remaining target; positive required pace when time remains; qualify as “No imported activity” under unknown coverage |
| Overachievement | Show actual, >100% and zero remaining/required pace; no negative values |
| Expired | Read-only “Period ended”; final imported actual/attainment/shortfall, no required future pace or divide by zero |
| Incomplete/unknown coverage | “Based on imported sessions; coverage incomplete/unverified”; values are provisional, not a confident year-end forecast. Missing history may overstate remaining effort |
| Metric query failed | Preserve goal configuration, show actual/attainment/remaining/pace unavailable; do not convert failure to 0% |

Synthetic arithmetic example only: at **2026-10-23 12:00 Europe/Athens**, week `[2026-10-19,2026-10-26)` has 4h actual against an explicitly synthetic 6h goal: 66.7%, 2h remaining, 2.5 calendar days left, **48 min/day**. No real goal is selected by this document.

## Task 30 — extend monthly Reports

Reuse current metric tiles, period selector, retained `date` reference, full previous-period identity, annual recap, session histogram and weekday distribution. Add **time per active day** as a compact fifth summary value (or adjacent text); do not duplicate existing four metrics. Reuse canonical daily buckets for a daily distribution chart/table with every local date, including successful zero buckets. Offer daily resolution within the existing “Reading over time” panel; retain useful weekly grouping as an option.

**Proposed new context panel:** “Monthly trend — selected year”, January–December totals from raw sessions in the selected year, with current month “In progress” and future months “Not started”, not historical zero. Empty past months mean “No imported activity”, not proven no reading. Selecting a trend month retains report identity/navigation. Avoid requiring raw session arrays in the client; extend the existing request-owned analytics context and bounded bucket payload. Do not introduce a second annual-recap page or a ranking card.

Formulas: reading hours `S/3600`; active days A; time/active day `S/A` seconds if A>0, otherwise unavailable (`—`, “No active days”); sessions N; estimated words W; daily distribution `S_d`; trend month `S_m`. Average session length used in observations is `S/N` when N>0 (including valid zero sessions), not S/A. Denominators must be named in labels.

Closed selected month compares **the complete immediately previous calendar month**, even January → previous December. February/leap years and 30/31-day months use actual calendar boundaries; no equal-day clipping. `delta=Xcurrent-Xprevious`; percent `100*delta/Xprevious` only when previous>0. For 0→0 show “No change (0 in both)”; 0→positive show absolute value plus “Up from 0”, no infinity/percentage. Missing/failed comparison is “Comparison unavailable”, not zero.

Current selected month is explicitly **In progress**. Preserve Reports' full calendar range/CSV contract; populated values represent imported occurrences in that month so far, with anomalies flagged. **Proposed v2.1 rule:** suppress comparative performance observations for the current month; no full-month-vs-partial-month growth claim and no projection. A future elapsed comparison requires the existing Overview elapsed wall-clock/clamping contract and an explicit “same elapsed period” label, not new ad hoc arithmetic. Future selected periods show “Not started” and no comparative claims.

Deterministic observations require successful current and previous stored-input reads and closed months. Up to two statements, in this order, computed from unrounded report values:

1. Reading-time change: direction and absolute minutes/hours, percent only for previous>0; equality says “Imported reading time unchanged”. Apply zero rules above.
2. If active days increased and both session counts>0 and S/N decreased: “More active days (A vs Aprev), shorter average sessions (value vs value)”. Otherwise show named time/active-day comparison if both A>0; otherwise show active-day difference with explicit counts.

If inputs are incomplete due to pending ingestion, suppress performance comparisons and show “Review is provisional; import is incomplete.” If historical completeness is unknown despite successful reads, permit observations **only about imported data**, prefixing that scope and retaining the caveat; do not assert complete account behavior. No observation claims causes, favorites, source/author/topic dominance or complete attribution. No AI API, token or external content generation is required.

Daily CSV remains exactly `date,reading_time_seconds,estimated_words,sessions`, as verified in `lib/report-csv.ts`; no new summary rows or rounded-source replacements. Preserve full-period rows, reference identity, Monday weeks and selected-year annual recap.

Synthetic monthly example: **September 2026**, 60 sessions × 720s = 12h; 18 active days → 40 min/active day; 162,000 estimated words. August: 48 × 750s = 10h, 15 active days → 40 min/active day; **135,024** estimated words because each 750s session rounds 2,812.5 to 2,813, then ×48. Time +2h/+20%; active days +3, average session 12 vs 12.5 min. This demonstrates per-session rounding; never derive words from total hours.

## Task 31 — provisional mobile candidates (maximum three)

| Candidate | Expected benefit | Evidence needed before selection |
| --- | --- | --- |
| Clearer period/reference controls within current Overview/Reports | Fewer taps and fewer accidental jumps to another period/year | 1–2 week diary of intended period, taps, backtracks and selection mistakes; reproduce on Safari/iPhone |
| Stacked goal/review values with readable dates and pace | Scan progress and monthly differences without clipped text or horizontal scrolling | Actual phone widths/font scaling, observed missed labels/truncation and ability to explain each value; compare current and proposed layouts |
| Clearer Settings entry to existing Start/Resume and sync evidence | Find the correct continuation action and distinguish partial/pause/completion | Diary of discovery failures, steps from Account, misunderstood statuses and attempted duplicate actions; no automatic sync experiment |

Preserve four primary tabs and Account menu, accessible labels/touch targets (at least existing 44px controls), keyboard focus, content reachability above the bottom bar and light/dark consistency. Actual usage determines final selection; no full redesign, native app or offline personal-data cache is included.
