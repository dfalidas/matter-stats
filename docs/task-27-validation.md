# Task 27 validation — preparatory, not historical acceptance

Baseline fetched from origin/main on 2026-11-04:
`5d9c6b559e4e45e59a5cfef662b05ea67ff0e7b6`. The initial checkout
`46e1dd09061bbb6a4f2ffba23fdcc64d15dc2883` was stale. Remote branch/PR
search found no Task 27 implementation; PR number 27 was unrelated and merged.
Draft PR: https://github.com/dfalidas/matter-stats/pull/93.

## Tested code

- `5f85a15a70f22859c764db64c6a540273cd6300a`: Node 22.23.4/npm 10.9.9,
  lockfile installation, route type generation, typecheck, lint, 421/421 tests,
  production build and unchanged audit policy PASS; full/production findings 0.
- `e0ed15122fe16acb8e82223457fcee57da0f4289`: adds historical month/year
  Overview/Reports UI card checks to the real SQL/CSV harness; lint/syntax PASS.
- `54bc0106925fcffc325fdecbe33ba5eebc953726`: final executable code, preserves
  exact division-then-multiplication word formula. Full typecheck/lint/test/build/
  audit PASS again locally (421 tests; full/production findings 0). Existing
  three lint warnings remain. No dependency, audit-policy or CI-gate changes.

Independent constants verify 1,005 one-second sessions = 1,005 seconds and 4,020
words, one active day, plus exact period-end zero-duration exclusion/inclusion.
Additional fixtures cover both Athens DST transitions, leap day, year rollover,
empty periods, all-unlinked rows, nullable timestamps/durations and observed
concurrent changes. Data API responses are capped at 137 rows to require full
pagination. Actual service paths and CSV formatter are invoked, not substitute
aggregators. Real schema/UI/CSV assertions extend the existing disposable harness.

## Interpretation and outstanding acceptance

No production diagnosis was performed. Production counts, deployment readiness,
stream generations/cursors and scheduled delivery from prior logs are historical
context, not newly verified evidence in this task. No private records or secrets
were copied into the repository or published artifacts.

No discrepancy has been established by successful synthetic service checks.
Real historical metric agreement remains unverified. Missing timestamps/NULL
durations can be stored; duplicate primary IDs and negative durations violate the
schema. Unlinked sessions affect attribution, not inclusion in totals. See the
operator guide for UI precision, Activity/year derivation and live-read limits.

Task 26 stays in progress. Final acceptance requires documented terminal evidence
for each agreed stream, a successful subsequent incremental cycle and a final
reconciliation on then-current data with declared consistency limits. Task 28 was
not executed. No real Matter sync/import/cron, production migration/repair/reset,
quota/retry/schedule/cursor/generation change, manual deployment or merge occurred.

Global raw quality counters include undated rows outside any assignable period.
The read-only API can be run after test compilation by an authorized operator;
see the operator guide for the explicit invocation. No live invocation was run here.

## Isolated browser evidence inspected

CI run [41831306679 attempt 1](https://github.com/dfalidas/matter-stats/actions/runs/41831306679):
`verify` SUCCESS and isolated browser/Supabase SUCCESS. Browser artifact
13322748904 was downloaded through the GitHub connector and inspected. ZIP SHA-256:
`3579e00d64df4650866c6dff0544dbc74cc25d7bd537962288c9403a330921cd`.
Identity: clean exact PR head `54bc0106925fcffc325fdecbe33ba5eebc953726`,
application/build/harness all same SHA; all five harness content hashes match
repository source. CI event merge SHA is `781111a4fde73bb4b64b1ceba659844fdd495171`;
this is distinct from the isolated job's actual checkout. Node 22.23.3/npm 10.9.9,
Postgres 17.6, 20 migrations, Europe/Athens app / America/New_York browser.

Browser phases 13/13 PASS; real SQL/Data API assertions 7/7 PASS; journeys 44 PASS,
zero failed/skipped/TODO. Real Matter requests 0, unexpected network 0, unexpected
Data API errors 0. Application processes, browser, stack and temporary directory
cleanup all verified. The existing synthetic ingestion/fault journeys also ran;
these are exclusively disposable-stack operations, never production operations.

Independent raw/CSV January 2025: 6 sessions, 420 seconds, 1,575 words, 3 active days.
Year 2025: 40 sessions, 514 seconds, 1,936 words, 11 active days. Exact differences
zero; month/year Overview and Reports cards also passed the new assertions.
Other existing CSV vectors cover daily/week/month/year boundaries, leap day,
Athens spring/fall DST, zero duration, empty day and Activity display pagination.
The new schema block passed negative-duration and duplicate-ID rejection plus
NULL timestamp/duration acceptance. Source completeness remains unverified.

## Local isolated attempts

Initial nested npm-exec toolchain could not launch pinned CLI. Upstream CLI's
node-fetch installer then attempted direct GitHub access and failed ECONNREFUSED.
The exact 2.48.3 archive was fetched through the configured proxy and its published
SHA-256 checked (`1d71e2c3c5a14456c34d2f015e487f9256ac15f2cb70b821337253f2478483cb`).
A temporary local npx dispatch used that binary; no repository harness was relaxed.
Local browser/DB runs on `e0ed151` then stalled starting disposable database images
(no images/containers materialized). Only those two owned CLI starts were terminated;
local suites are **blocked, not passed**. Successful browser evidence above comes
from clean CI on `54bc010`, not these local attempts. Browser OS-dependency install
also lacked root; browser binaries downloaded separately. No production fallback.

## Final CI result

Run 41831306679 attempt 1 **SUCCESS 3/3 jobs**. Verify checkout logs confirm
synthetic merge `781111a4fde73bb4b64b1ceba659844fdd495171`, 421/421 tests,
typecheck/lint/build PASS, enforced full/production audit 0/0 (audit-policy test
fixtures deliberately print failing examples earlier in the test log; those are
not the actual audit result). Browser and fresh/upgrade jobs test clean exact
head `54bc0106925fcffc325fdecbe33ba5eebc953726`.

Fresh/upgrade artifact 13324131034 downloaded and inspected; ZIP SHA-256 matches
GitHub `3833f356d2a12ea5d63c53f084b9a3f5ffd35f3821d9e73bb0f6dd7d0d191d03`.
29/29 phases PASS, synthetic restore 10/10, 26 tables preserved, no failed/skipped/
TODO/blocked/running phases, fresh/restore/upgrade resources and temporary directory
verified removed. Browser ZIP digest above also matches GitHub. Local stalled
browser cleanup verified stack/temp removed with app/browser never created.

The final documentation-only commit adds this report and the exact optional
read-only invocation. Executable sources are unchanged from tested `54bc010`.
Any CI automatically triggered by that documentation push is separate from the
completed run recorded here; do not claim it passed until observed.

Next: review draft PR #93 without merge. Continue Task 26 through its separately
authorized existing workflow; after stream completion and incremental success,
run the documented month/year checks privately on then-current data and resolve
any unexplained differences before final historical acceptance.
