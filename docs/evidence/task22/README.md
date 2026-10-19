# Task 22 synthetic UI evidence

Application/build source: `877fae00126141b60fc7a60f6690c8f02a9cab22`.
Browser verifier source: `9097b2298f3a4641b97a2d81bcae3e644e76fc64`.
The verifier checks that application, component, library, dependency and theme files are identical between those sources. Final evidence/documentation changes preserve that tree. Every screenshot is an actual Chromium render against an isolated production Next server and loopback synthetic Data API; browser timezone is America/New_York and APP_TIMEZONE is Europe/Athens. No production synchronization or scheduled execution is certified.

**Result:** 159 page/state checks, 21 behavioral groups, 66 scroll records and 30 measured contrast checks (minimum 5.4:1) passed. Thirty phase screenshots and two supplemental views were captured; representative frames below were visually inspected.

[Completed phase manifest](completed/ui-validation.json) aggregates separately successful layout processes at each width, interaction flows and independent states. Its phase records identify the exact source, build source, inputs and results. Per-phase manifests include contrast/scroll checks, browser errors and blocked external requests. [QA findings and limitations](../../task-22-qa.md) and the [route inventory](../../task-22-route-inventory.md) describe the scope.

Representative rendered frames selected for visual inspection:

| Render | Evidence |
| --- | --- |
| Mobile Overview and explicit completion timezone | [390 light](completed/layout-390/normal-dashboard-390-light.png) |
| Final Activity pagination clear of fixed navigation | [390 light, scroll end](completed/layout-390/scroll-end-activity-390-light.png) |
| Nullable detail metadata and declared dark palette | [390 dark](completed/layout-390/normal-articlessynthetic-item-000-390-dark.png) |
| Native table title keyboard focus | [768 light](completed/layout-768/table-keyboard-articles-768-light.png) |
| Horizontally scrolled table right-hand columns | [768 light](completed/layout-768/table-horizontal-articles-768-light.png) |
| Account Settings/logout menu and current Settings state | [390 light](completed/layout-390/account-settings-390-light.png), [768 dark](completed/layout-768/account-settings-768-dark.png) |
| Selected 2025 report, comparison 2024, recap link and CSV control | [1440 light](completed/layout-1440/normal-reports-1440-light.png) |
| Actual chart tooltip/axis text contrast | [1440 dark](completed/layout-1440/chart-hover-reports-1440-dark.png) |
| Selected day and complete totals | [390 light](completed/flows/selected-day-activity-390-light.png) |
| Retained linked-source ranking and annual recap | [768 source ranking](completed/flows/linked-sources-768-light.png), [390 recap](completed/flows/linked-year-in-reading-390-light.png) |
| Partial import/pending continuation | [390 Overview](completed/states/partial-dashboard-390-light.png) |
| Independent metrics query failure | [390 Overview, error in view](completed/supplement/metrics-unavailable-dashboard-390-light.png) |
| Unsupported annual attribution remains separate from 25 imported sessions | [390 recap](completed/supplement/unsupported-year-in-reading-390-light.png) |
| Ready repair candidate remains unapplied | [768 Settings](completed/states/candidate-settings-768-light.png) |

[Before dark-rule retention](before-dark-rule-6dd7acc.png) and [its measured source/style metadata](before-dark-rule.json) document the actual pre-fix production CSS at `6dd7acc6913746951e69176169dad31aaca88548`; this is specifically before the dark/contrast fix, not a claimed screenshot of the base commit.

[Validation commands](validation-commands.json), [sanitized output](validation-output.txt), [full audit](audit-full.json) and [production audit](audit-production.json) retain local outcomes, including the failed unchanged dependency audit policy. Interrupted attempts remain excluded; they are not relabeled as passed checks. Archived execution drivers accompany the evidence for review; use the QA document's commands with new output directories to reproduce.
