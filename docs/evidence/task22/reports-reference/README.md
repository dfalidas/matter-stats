# Reports calendar-reference correction

Application/test source: `22f639a475e73f911b2c6e41f3e662dceceb1547`. Production build source: `3c54ea8511d90538074a9c9d328eb067a917229c`; final browser harness source: `8192206bb1995440248110e117776a1296108f36`; its application/test tree is identical. The isolated production build uses that application tree. Every new image is an actual synthetic Chromium render; browser America/New_York, APP_TIMEZONE Europe/Athens. No production credentials or requests, synchronization, repair or deployment.

**Reports phase passed:** [manifest](reports/ui-validation.json), 12 recorded render checkpoints, three comprehensive behavioral groups, eight screenshots. Representative images linked below were visually inspected: mobile weekly/return, tablet March and desktop dark weekly/leap. Browser/page/resource errors, external requests and unexpected mutations: zero.

**Existing interaction flow also passed:** [manifest](flows/ui-validation.json), 14 recorded checkpoints, six behavioral groups, four screenshots. The current correction evidence totals 26 checkpoints, nine behavioral groups and 12 screenshots; all browser/console/resource errors, external requests and unexpected mutations are zero. This rechecks the annual CSV/labels/recap/legacy path and preserves the existing unrelated interaction coverage.

| Scenario | Viewport/input | Result/evidence |
| --- | --- | --- |
| 2025 Year → Week → Year and annual recap | 390 touch; 768/1440 keyboard; light/dark | Week selection stays 2025-01-01 with recap 2025; Year returns to 2025. Range remains Dec 30–Jan 5 and previous week Dec 23–29. [390 weekly](reports/retained-year-week-reports-390-light.png), [390 return](reports/retained-year-return-reports-390-light.png), [1440 weekly dark](reports/retained-year-week-reports-1440-dark.png). |
| March 2025 → Week → Month | Same widths/input | Selection stays March despite February 24 week start. [768 weekly](reports/retained-march-2025-week-reports-768-light.png). |
| March 2024 leap-year boundary | Same widths/input | Selection stays March; real week includes February 29. [1440 weekly dark](reports/retained-march-2024-week-reports-1440-dark.png). |
| Explicit Apply after frequency change | Same widths/input; submitted form | Applying 2025-01-02 changes the subsequent year and recap to 2025; service/UI regression also applies leap day 2024-02-29. |
| Back/forward/reload; repeated URL context | Same widths/input | Both primary round trips retain selection after history/reload and preserve both `context` values. Actual recap navigation returns to the same year report. |
| Missing/invalid references; legacy weekStart; unavailable report | Same widths/input | Missing/invalid use Athens today; invalid `date` does not fall through to legacy input. Legacy Jan 2 retains 2025 and converts to canonical `date`. Unavailable Year → Week → Year remains usable. Unit tests also cover repeated references and failures. |
| Actual weekly CSV names/ranges/totals | Downloads at all three widths | Dec30–Jan5: 601s / 2,254 words / 2 sessions; Feb24–Mar2: 62s / 233 / 2; leap Feb26–Mar3: 60s / 225 / 1. CSV names use each Monday; rows use actual local dates and unchanged canonical columns. |

**Local validation:** locked install, required route types, typecheck, lint, focused 29 tests, full 388 tests, production build and diff/scope checks passed. Tests: zero failed/cancelled/skipped. Lint: eight existing local skill/scratch warnings, no errors; the final browser-only fixture correction separately passed targeted lint and syntax checks. **Audit failed** under the unchanged policy: eight high development entries, zero production vulnerabilities; compatible-remediation metadata expires the existing exception. Local opt-in database verification was not enabled and is not counted as passed. PR #85 records exact final-head CI and remaining gates.

[Commands and exit/timing results](validation-commands.json), [archived execution driver with synthetic configuration](validation-driver.mjs.txt), [sanitized output](validation-output.txt), [full audit](audit-full.json) and [production audit](audit-production.json) retain the current run. The driver began at application source 22f639a. The browser-only synthetic theme restoration at 3c54ea8 was committed before route/type/lint/test/build checks. The later browser-only fixture selection at 8192206 was separately linted/syntax-checked; no application/test/dependency tree changed. The browser manifest records its own exact harness and build source SHAs. Later documentation/evidence commits preserve those trees; exact final-head CI is reported in PR #85.

Historical development attempts remain explicit: the new regression run against baseline behavior failed four cases (9 passed/4 failed), exposing normalized-boundary selection. A first corrected run had 12 passed/1 failed because a test compared a Date object to a string; the assertion was corrected to compare ISO timestamps, then all 13 UI tests passed. These intermediate runs are not passed validation. The first browser attempt at 3c54ea8 failed a fixture assumption: generic `unavailable` leaves session reads available, so Reports correctly loaded. The final runner selects the existing `metrics-error` scenario; no product error mapping changed. That incomplete attempt is excluded from passed counts and preserved in the workspace. [Development attempt record](development-attempts.json). Original Task 22 audit, interrupted browser/build/type attempts and the reviewed-head Docker quota failure remain documented in the parent QA record and PR.

Reproduce from the committed source using synthetic configuration (see parent QA), locked installation, route generation, test compilation and a fresh production build first:

```sh
export TASK22_PLAYWRIGHT_MODULE=/opt/codex/runtimes/cua/lib/node_modules/playwright/index.mjs
export TASK22_BUILD_SOURCE_SHA="$(git rev-parse HEAD)"
TASK22_PHASE=reports TASK22_EVIDENCE_DIR=work/reports-reference-rerun/reports node scripts/task22-ui-verify.mjs
TASK22_PHASE=flows TASK22_EVIDENCE_DIR=work/reports-reference-rerun/flows node scripts/task22-ui-verify.mjs
```

Use new output directories. The harness blocks external browser traffic, rejects unexpected mutations and verifies the application tree against the declared build source. The old 159-check evidence remains historical; this correction does not rerun every unrelated layout/state combination. Chromium emulated touch/keyboard is not screen-reader, physical-device or cross-engine certification. Production historical coverage and scheduled execution remain unverified. No migration/configuration/dependency change; application-only rollback preserves all Task 21 evidence and progress.
