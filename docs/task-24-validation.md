# Task 24: isolated end-to-end verification and release evidence

Scope: Task 24 / W8 Gate B only. Fetched latest main before editing on
2026-10-21: **7723e13af842d456828a47897532d56722c79acb**, identical to the supplied
Task 23 baseline. There were no subsequent main changes. Root `AGENTS.md` is the
only applicable tracked contributor instruction. Tasks 01–23 remain intact.
Implementation and exact-head execution identities are recorded in the draft PR
and each run's `identity.json`; dirty runs include hashes of the harness files.

**Task 24 acceptance remains open while actual hosted staging is BLOCKED/NOT RUN.**
Local/CI Docker verification is category B. It cannot certify hosted staging,
production readiness, production backup, historical completeness or Vercel delivery.

## Requirements and evidence matrix

| Requirement / journey | Existing coverage and limitation | New verification / evidence | Environment / result | Remaining external gate |
| --- | --- | --- | --- | --- |
| A: unit/component, synthetic browser | Tasks 01–23 application suite; Task 22 production Next pages against fake Data API, detailed route/layout/contrast and PR #85 calendar assertions | Retained; transport safety regressions added | A **PASSED**: 403 tests and required commands; CI `verify` | Does not prove persisted Supabase state |
| B: browser → production app → real SQL/Data API → rendered data | Task 23 real SQL/runtime suites had no production browser/application server chain | `test:full-stack`; owned Supabase, full migration chain, production build/start, real session/ingestion/RPC/rollup writes | B **PASSED** at `69fdc63`; `outcomes.json`, `database.json`, `build.json`, `journeys.json` | Hosted application and DB still require C |
| Login/access/logout | Auth unit/concurrency/security suites; Task 22 fake auth storage | Form wrong/correct/limited/storage-failure login; missing/malformed/expired/revoked/version-invalid session; real hash row; Secure/HttpOnly/Lax; action replay denial; logout DB revocation/cookie removal/replay rejection | B **PASSED** at `69fdc63`; `authentication`, `logout-replay` groups | Hosting proxy/cookie configuration |
| Analytics/CSV/calendar | Canonical metric tests; 601 boundary and >10,000 generation tests; Task 22 synthetic reference/CSV | Independent explicit UTC/local date vectors and every downloaded CSV row; unlinked sessions, metadata sentinel, per-session rounding, exclusive endpoint, Monday weeks, Athens midnight/DST/year/month; PR #85 frequency/history/reload | B **PASSED** at `69fdc63`; `analytics-csv`, fixtures and selected screenshots | Actual hosted reads and deployed timezone |
| Library/Activity/navigation | Task 22 100+5 library, 20+5 activity, secondary routes and mobile/desktop QA using fake API | 105 real library rows, combined filters/stable pages, null/zero metadata, keyboard details; 25 real sessions with unchanged whole-day totals; all primary/useful secondary routes, mobile final controls | B **PASSED** at `69fdc63`; `navigation-library`, screenshots | Hosted browser journeys |
| Manual/cron/continuation | Real DB runtime suites cover fencing, receipts, page atomicity, retries, 5,000-row continuation and restart; prior route handler tests lack HTTP | Actual UI controls and GET cron route, missing/wrong/query-secret rejection without work, one-owner concurrency, 19-page unchanged-budget import, manual→scheduled→manual across process restarts, real rows/checkpoints/receipt/rollup reconciliation | B **PASSED** at `69fdc63`; `sync-continuation` | Explicit cron request is not scheduler delivery |
| Fault/recovery | Task 23 detailed real DB stale-fence/page/retry suites | Process transport 429, timeout, interruption/lost persisted response; truthful settings, retained state, natural eligibility and recovery; no quota/progress reset | B **PASSED** at `69fdc63`; `sync-faults` | Hosted interruption/runtime behavior; real scheduled recovery |
| Truthful status/independent failure | Task 21 semantics and real status RPC/security; Task 22 broad fixture-only state matrix | Runtime partial/completed/failed/skipped states; supplementary SQL never/stale/incomplete-metadata/dirty/candidate demonstrations against real reads; independent read transport failures versus successful empty | B **PASSED** at `69fdc63`; `truthful-status`; fixture states explicitly labeled | Production coverage, history and actual freshness |
| CI/evidence/cleanup | Task 23 fresh/upgrade and synthetic backup→restore, owned cleanup | Separate bounded secret-free browser job, event SHA check, explicit artifact allowlist, outcome distinction, generated test credentials and verified exact-owned cleanup | B **PASSED** at `69fdc63`; identity/toolchain/outcomes/network/browser/cleanup JSON | Branch protection unchanged; human review |
| C: actual hosted staging | Only one connected Vercel project, one production-named Supabase project, zero development branches and zero custom environments found on 2026-10-21 and confirmed at recovery; previews are not proof of isolation | No hosted runtime checks, database mutation or credential use; [operator procedure](task-24-execution-guide.md#actual-hosted-staging-gate) | **BLOCKED / NOT RUN** | Authorized isolated app+DB, synthetic upstream, private credentials, verified deployed SHA/configuration |
| D: production and real scheduled cycles | Baseline main CI success is isolated evidence only | None under this task | **NOT RUN** | Production authorization/configuration/schema/backup/restore, separate repair/cutover, two actual scheduled cycles |

## Independent reference contract

`scripts/task24-fixtures.mjs` imports no application aggregation/calendar helpers.
Each UTC timestamp has an independently specified Athens calendar date. Reports
CSV rows are reconciled to that reference, including zero dates and exact header
`date,reading_time_seconds,estimated_words,sessions`. CSV dates are local calendar
dates; ranges use inclusive first/last display dates and half-open instant bounds.

- Three unlinked 60-second sessions on 2025-01-02: **180 seconds, 675 words, 3 sessions**.
  The 120-second session at 2025-01-02 22:00Z (Athens next midnight) is excluded.
- Week containing 2025-01-01 is Monday 2024-12-30 through Sunday 2025-01-05:
  **301 seconds, 1,129 words, 6 sessions**, including a zero-duration session.
  The session exactly at 2025-01-05 22:00Z belongs to the next week.
- Cross-month week containing 2025-03-01: **62 seconds, 233 words, 2 sessions**.
  Leap-year counterpart: **60 seconds, 225 words, 1 session**.
- Two one-second sessions across each Athens DST transition: **2 seconds, 8 words**.
  Each session contributes four words. The 25-session case below distinguishes
  per-session rounding (**100**) from rounding the combined duration (**94**).
- Activity 25 one-second sessions: **25 seconds, 100 words, 25 sessions** on both
  visible pages, 20 then 5. Library sizes include NULL, zero and 999,999-word metadata;
  persisted old estimates use an intentionally incorrect sentinel. Neither becomes
  canonical reading estimates. Browser timezone is America/New_York throughout.
- Sync fixture: 19 short pages through the production eight-page budget; **19 unique
  sessions, 1,140 persisted seconds, 4,275 persisted words**. Short responses are
  legitimate paginated envelopes; no production budget/page limit/quota is reduced.

Existing expensive real DB suites remain in the unchanged fresh/upgrade gate:
security/login concurrency, lease fencing, atomic pages/rollup recovery, 0–600 second
word vectors, 5,000 sessions, >10,000-session repair/cutover/rollback and truthful
status. These are reused coverage, not duplicate new browser assertion counts.

## Execution and evidence status

### Recovery checkpoint — 2026-10-21

Resumed after the five-hour interruption. Read root `AGENTS.md`, inspected the
clean worktree, recent commits, remote branches, PR/reviews, ignored work/evidence,
processes and Docker inventories before editing. Local HEAD and draft PR #87 head
were both `160ed48f93340c0056abdb450fec17566a4ae85f`. Refetched main remains
`7723e13af842d456828a47897532d56722c79acb`; no subsequent changes. No uncommitted
or untracked nonignored files. No live task app/browser/build processes, containers,
volumes or task temporary stack directories remained. Six defunct Next process
entries and their six defunct Node wrappers owned by PID 1 are exited processes,
not running servers; no blind kill or
resource removal was performed. PR #87 is open/draft, with no human reviews.

| Requirement | Existing implementation | Actual evidence and tested SHA | Remaining work | Current outcome at recovery |
| --- | --- | --- | --- | --- |
| A / supported application checks | Node 22 lockfile, route types, typecheck, lint, tests, production build and unchanged audit | [CI 39568890074](https://github.com/dfalidas/matter-stats/actions/runs/39568890074), head `160ed48`; verify passed | Final candidate checks | Implemented and verified at recorded source |
| B / auth, analytics, navigation, real ingestion and faults | Owned real Supabase + production browser harness | Same run, artifact [12331810196](https://github.com/dfalidas/matter-stats/actions/runs/39568890074/artifacts/12331810196), SHA-256 `b31b4c611ba0868213fdb9e0db1c5239873a17b714f2c01eed4227c3f3940f70`; 30 behavioral groups passed before generation assertion | Diagnose generation boundary; run remaining logout/network assertions and rerun affected checks | Implemented; overall FAILED, not accepted |
| B / generation candidate status | Real isolated `repair_prepare` then Overview/Settings reads | Same head, `task24-journeys.mjs:1012`; real Data API errors 0 | Determine actual persisted status contract and smallest necessary correction | Failed |
| B / logout and final network audit | Implemented | Same run: not-run after failure | Execute | Implemented but unverified |
| Task 23 fresh/upgrade and synthetic restore | Existing full gate retained | Same run, database job passed; [artifact 12331712608](https://github.com/dfalidas/matter-stats/actions/runs/39568890074/artifacts/12331712608) | Inspect final candidate artifact | Verified at recorded source |
| Cleanup | Exact owned-resource checks | Browser artifact: processes removed, browser closed, stack and temporary directory removed; current local Docker/task-temp inventory empty | Final candidate cleanup | Verified for this completed attempt; canceled historical jobs remain unverified where recorded |
| Local Docker provisioning | Existing full-stack command | Earlier dirty/base-keyed local attempt blocked by disk capacity before browser/DB assertions | Use adequately sized CI runner; retain original outcome | Blocked infrastructure |
| Release evidence, visual inspection, PR and tracker | Docs/guide and draft PR #87 exist; ignored sanitized artifacts/screenshots preserved | Two partial-run desktop captures inspected at original `2af68b2` source; PR description still in-progress | Inspect completed captures, retain allowlisted results, finalize docs/PR/Craft | Interrupted |
| C hosted staging / D production and scheduling | Operator procedure exists | Discovery found no authorized isolated hosted target | External setup/authorization; production work outside scope | C BLOCKED/NOT RUN; D NOT RUN |

Recovery diagnosis: `read_matter_generation_status` legitimately returns SQL NULL
for a newly prepared candidate's reconciliation conjunction before evidence exists.
The application reader previously rejected that whole successful status response,
hiding the known frozen/unapplied state as unavailable. A narrow reader correction
normalizes only this NULL flag to false; malformed values still fail closed. Two
focused regressions and a real SQL NULL assertion cover the boundary. No migration,
reconciliation/cutover condition or writer behavior changes. This is the sole
application correction in Task 24; final execution results follow below.

Reproduce using the [execution guide](task-24-execution-guide.md). The recovery
application run at `8c1675db97449e1abf35ad04ad192b0ffc2c1349` passed `npm ci`
(458 packages), route-type generation, typecheck, lint, **403/403 application tests**,
production build and `audit:ci` on Node 22.23.3/npm 10.9.9. Local lint had zero errors
and three pre-existing ignored skill-script warnings; tracked CI lint passed.
[Sanitized local outcomes](evidence/task24/local-validation.json) identify the
documentation-only dirty scope. No real database/Matter connection was used for A.
The opt-in DB suite's ordinary-test skip is not a DB pass. Audit remains eight high
development entries and zero production vulnerabilities, with unchanged policy.

Completed browser/database results and inspected screenshots are recorded below.
Pending checks are not passes. The historical Task 22 Node 24/npm 11 local audit
failure versus Node 22/npm 10 CI pass remains at its original SHA/date in
[Task 22 QA](task-22-qa.md); audit policy and exceptions are unchanged.

### Completed full-stack checkpoint

Tested application/build/harness/checkout:
**`69fdc63b69383efbb064a6ee92b7edba657e16e1`**, clean PR-head checkout, base
`7723e13af842d456828a47897532d56722c79acb`. Environment **B**, local disposable
Supabase containers on a GitHub Actions runner. [CI run 39597331904, attempt 1](https://github.com/dfalidas/matter-stats/actions/runs/39597331904).
[Immutable identity/build records and outcomes](evidence/task24/verified-69fdc63/)
retain event merge SHA separately from PR head, build ID, content hashes, timestamps,
configuration scope and all 20 ordered migration versions.

| Verification unit | Actual result |
| --- | --- |
| Application `verify` | 403 passed, 0 failed/cancelled/skipped/TODO; route types, typecheck, lint, production build and audit passed |
| Browser behavioral groups | **32 passed**, 0 failed/skipped/TODO, including 13 independently reconciled CSV cases |
| Full-stack database phase groups | **7/7 passed**; migrations, sessions, analytics reference, ingestion, faults, status, logout; real SQL/Data API true |
| Overall browser harness phases | **13/13 passed**, no blocked/not-run/running groups |
| Separate Task 23 database gate | **29/29 phases passed** across fresh/upgrade; nested synthetic backup/restore **10/10 stages**, all-column equality for 26 tables, catalog/security and real Data API checks passed; all three owned stacks and temporary directory removed |
| Network/browser observations | 2,239 real DB requests; 72 controlled synthetic Matter requests; real Matter and unexpected network requests 0; real Data API errors 0; browser console/page errors and failed resources 0 |
| Deliberate faults | Exactly one 429, timeout and interrupted upstream attempt each; real page-response loss reconciled by receipt; 39 database-transport fault decisions including that response loss and retryable storage/independent outage scenarios |
| Owned cleanup | App processes removed, browser closed, exact created stack containers/volumes/network absent, private temporary directory removed |

These units are separate, not a combined test total. Toolchain: Node **22.23.3**,
npm **10.9.9**, Supabase CLI **2.48.3**, Postgres **17.6**, Next **15.5.27**,
Playwright **1.64.1**, Chromium **156.0.8078.4**. APP_TIMEZONE Europe/Athens,
browser America/New_York. The [browser ZIP](https://github.com/dfalidas/matter-stats/actions/runs/39597331904/artifacts/12344324796)
was downloaded and its digest verified:
`e4274a9a21381114ee7a689cb18e31eebfb5e1c22a38d7d56860cedd11401aa2`.
[Provenance](evidence/task24/provenance.json) records original artifact identities.
The [separate database ZIP](https://github.com/dfalidas/matter-stats/actions/runs/39597331904/artifacts/12344569555)
was also downloaded/digest-verified:
`6b82eeadecdae09aa21a8853b075587d86b6a449942bab134a04a18738a3648c`.
[Retained database records](evidence/task24/database-69fdc63/) include both migration
inventories, security reports, outcomes, synthetic restore metadata and cleanup.
The dump itself was not uploaded or committed. This is not a production backup.

All seven real-browser screenshots were visually inspected on 2026-10-21:
[675-word Overview](evidence/task24/verified-69fdc63/overview-desktop.png),
[cross-month Reports](evidence/task24/verified-69fdc63/reports-cross-month-desktop.png),
[mobile final Activity controls](evidence/task24/verified-69fdc63/activity-mobile-final-control.png),
[mobile Reports](evidence/task24/verified-69fdc63/reports-mobile-three-sessions.png),
[partial Settings](evidence/task24/verified-69fdc63/settings-partial-desktop.png),
[persisted 19-session Overview](evidence/task24/verified-69fdc63/overview-synced-desktop.png),
[independent outage](evidence/task24/verified-69fdc63/overview-independent-outage-desktop.png).
Controls, retained period/totals, partial/completion uncertainty and independent
outage sections agree with the assertions. The mobile Activity final controls are
above the fixed navigation. No secret or personal content was observed. This is
viewport inspection, not hosted staging or a new formal accessibility certification.
[Inspection notes and image hashes](evidence/task24/visual-inspection.json) are
separate from the untouched harness manifest, which initially says pending.

At `8c1675d` all 32 behavioral groups passed but the final console assertion failed;
[its original evidence](evidence/task24/recovery-8c1675d/) is retained as FAILED.
The runner now drains requests and pauses new browser traffic during deliberate
server restarts; every request still reaches the recreated real application.
The console assertion remains unchanged and passes at `69fdc63` with zero errors.
Final documentation/evidence changes do not replace this tested source identity.
Final process review additionally made Chromium's child environment explicit with
the same sanitizer used for CLI/build/server processes. The secret-free CI
checkpoint remains valid at its original source; this local-isolation hardening is
rerun at the final candidate, whose harness content hash differs accordingly.
Final candidate SHA and exact-head CI/artifact links are recorded in draft PR #87;
affected checks must pass again at that final head before handoff.

[Attempt history](evidence/task24/attempt-history.json) preserves failed/interrupted
CI identities and cleanup limitations. [Recovery failure evidence](evidence/task24/recovery-160ed48/)
retains the 30-group partial browser run at its original SHA. The earlier local
[provisioning attempt](evidence/task24/local-provisioning-blocked/) was blocked by
disk capacity before database/browser assertions. Its base-keyed dirty identity
does not certify the baseline. Canceled jobs and historical long-ID absence checks
are not independently verified cleanup; current short IDs match CLI-created names.

## Impact and rollback

The only application correction is the candidate-status reader described above:
SQL NULL reconciliation means unproven, retaining frozen/unapplied status. There is
no authentication, metric/timezone/attribution, migration, generation/progress,
quota/backoff/fence/receipt or cron change. `0 6 * * *` UTC is unchanged.
Existing disposable orchestration functions are exported for reuse;
Task 23's fresh/upgrade/backup/restore flow is unchanged. Only development dependency
`playwright` **1.64.1** and its exact matching `playwright-core` lock entries are added
(458 installed packages versus baseline 456). No unrelated package refresh or audit
exception. Generated synthetic app/cron/Matter secrets and freshly signed local
service-role JWT stay in private memory; only owned local Kong accepts that test key.

Rollback is a code-only revert of this task's status-reader correction,
scripts/tests/docs/workflow and the two development lock entries. Reverting the
reader restores its earlier unavailable display for new candidates; no persisted
repair state changes. Preserve every applied migration and all durable data.
There is no production SQL, data rollback, secret rotation or deployment to perform.

Release gates still require focused PR review/merge approval, final-head CI, hosted
staging C, actual production configuration/runtime/backup/restore, separately
authorized historical repair/cutover and two real scheduled cycles. None is closed
by a preview status, manual cron request, fixture state or local green test.
