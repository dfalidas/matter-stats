# Task 30 — enriched monthly Reports

Use Reports → Month → a validated calendar month. The four existing totals remain;
time per active day appears beside the monthly introduction. Reading over time
defaults to **Daily** for months, with **Weekly** (Monday first) available. Expand
“Daily values (all local dates)” for exact canonical seconds, including successful
zero dates. Weekly and yearly Reports keep their existing grouping and navigation.

“Monthly trend — selected year” lists all twelve months of the selected report's
year. Each month is a keyboard-accessible link to its monthly report; retained URL
context, selected date/year, previous-month identity and annual recap follow it.
Current months show **In progress**; future months show **Not started**, with no
zero-total implication. Empty closed months say **No imported activity**. These
labels do not establish that no reading happened upstream.

## Arithmetic and presentation

APP_TIMEZONE (default Europe/Athens) and one request-captured instant govern the
page, report, status evidence and trend. Full local-calendar [start,end) boundaries
are converted independently to UTC. Sessions belong entirely to the local date
of started_at, including sessions that cross midnight. No interval splitting.

- S: sum canonical raw duration seconds; N: imported session count, including zero
  duration; A: local dates with positive summed duration.
- Estimated words: sum `Math.round(duration_seconds / 60 * 225)` **per session**,
  after established canonical normalization. Article word_count and stored legacy
  word estimates do not enter this calculation.
- Time per active day = S/A if A>0, otherwise **— / No active days**.
- Average session = S/N if N>0. Observations compare this exact ratio, rather than
  the existing rounded legacy average-session field or time per active day.
- New time labels round the final total/ratio to a minute; positive values below
  30 seconds show **<1 min**. Longer totals use hours/minutes; percentages use one
  decimal with optional trailing .0, and average sessions use one decimal minute.
  Chart coordinates retain seconds/60 without rounding the source buckets.

September's synthetic example is 43,200s/60 sessions/18 active days/2,400s per
active day/162,000 estimated words. August is 36,000s/48/15/2,400s/135,024 words.
The difference is 7,200s (+20%), three more active days, and average sessions
720s vs 750s (12.0 vs 12.5 minutes). All comparisons use unrounded inputs.

CSV is unchanged: `date,reading_time_seconds,estimated_words,sessions`, one row per
full-period local date. No summary rows, elapsed-period clipping or projections.

## Comparison and coverage rules

A closed month compares with the **whole immediately previous calendar month**,
including January → previous December, leap February and unequal month lengths.
Two deterministic observations at most, ordered reading-time change then rhythm:

1. Imported reading-time increase/decrease and absolute difference; percentage
   only if previous S>0. Equality says “Imported reading time unchanged”; 0→0 adds
   “No change (0 in both)”; 0→positive says “Up from 0” without percentage.
2. More active days plus shorter S/N when A increased, both N>0 and exact S/N
   decreased. Otherwise explicitly named S/A comparison when both A>0, or active
   day counts and signed difference. The denominator is always named.

Current/future months have no performance observations. Pending/running history,
active session or library stream cycles, pending request chains or manual recovery
suppress comparisons and show **Review is provisional; import is incomplete.**
Absent/failed/malformed status evidence shows import status unavailable and
suppresses comparisons. Successful, inactive stored evidence permits statements
only about **imported sessions**, retaining the unverified upstream-history caveat.
Enumeration exhaustion never upgrades coverage to verified complete history.
Session–item linkage is a separate limitation and never removes unlinked sessions.

A failed current read is an unavailable report. Failed previous input retains
current values and previous-period identity with **Comparison unavailable**;
failed selected-year input displays **Monthly trend unavailable**. No failed
input becomes a visible zero. Invalid/NULL durations and future occurrence counts
are visibly flagged; established normalization and full-calendar export semantics
remain, and stored rows are never repaired by this feature. No AI or external
text generation, attribution, causal explanation, ranking or projection is used.

## Query impact and consistency

One authorized server invocation owns one analytics context. Monthly current and
previous detail reads feed canonical metrics, bounded review summaries, histogram
and internal timeline without duplicate reads. A single lean selected-year raw
read aggregates twelve monthly totals; no per-day/per-month database loop and no
raw session array reaches the client. Three bounded status reads reuse the existing
stream, continuation and retry evidence contract. The unconsumed all-history
streak scan is omitted for monthly Reports; other periods retain it. Query pages
still use complete stable (started_at,id) keysets, including server-capped short
pages and tied microsecond timestamps; only successful empty pages end a scan.

Payload scales with at most 31 daily buckets, 12 monthly totals and fixed summary/
histogram values. Selected and previous inputs use the same context within the
request. Year/status/metadata reads and separate page requests do not share a
Postgres MVCC snapshot; concurrent writes may change observations. No production
latency benchmark or upstream completeness is claimed from isolated fixtures.

## Rollout and recovery

No migration, dependency change or configuration change is required. Existing
ordered schema through Task 29 remains prerequisite. Review the draft and actual
candidate checks/artifacts before a separately authorized rollout. A Git push may
create automatic preview deployments; these are not production acceptance or
proof of an isolated preview database. Do not invoke real sync/import/cron or
mutating validation against previews/production.

After authorized release, check the authenticated Reports flow and unchanged CSV
using the actual deployed candidate. Rollback by reverting this task's application
changes to the reviewed baseline; no data rollback or down migration is needed.
Task 26 import, Task 27 final real-history reconciliation after terminal stream
completion and subsequent incremental success, and conditional Task 28 remain
separate gates. Task 29 retains its existing user-provided production acceptance.
Tasks 31–32 are not implemented or closed here.
