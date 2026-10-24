# Task 25 / PR #88 — CI correction

Date: 2026-10-24, Europe/Athens. Base: current `main`
`32f23cc8260acf9afd90087e28f9dde1993d7ed8` (PR #87); no newer main or existing
corrective branch/PR was found. [PR #88](https://github.com/dfalidas/matter-stats/pull/88)
remains documentation-only, draft/open/unmerged at reviewed head
`73f941eb49da751fa4eabbf08f5bdd3074622aa5`. Corrections are on a separate branch
from main, with dependency and browser changes in separate commits.

## Original evidence

[Run 39964474867](https://github.com/dfalidas/matter-stats/actions/runs/39964474867)
passed typecheck, lint, 403 tests and build, then failed production audit.
Its independent fresh/upgrade DB job passed. Browser failed at
`task24-journeys.mjs:512`, immediately after `page.goBack()`: 6 phases passed,
1 failed, 6 not run, cleanup verified; no page errors/unexpected requests.

Downloaded audit/browser ZIP SHA-256 values match both GitHub and the Craft
review. Selected unchanged sanitized JSON is retained under
[original-73f941e](evidence/task25-ci/original-73f941e/provenance.json), including
the failed outcomes, failure location, browser observations, cleanup and audit.
No old outcome was overwritten or relabeled as corrective success.

Corrective [PR #89](https://github.com/dfalidas/matter-stats/pull/89) is separate
from PR #88 and remains draft/open/unmerged.

## Production audit: supported patch, unchanged policy

Primary sources:

- [Next.js GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw):
  critical Image Optimization/upstream-library RCE risk; Next 10.0.0–15.5.27
  affected, 15.5.28 patched. The existing `sharp` 0.35.5 override already meets
  the documented workaround; it does not clear Next's version-based advisory.
- [Next.js GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r):
  high App Router/Server Actions CPU denial of service; Next 13.0.0–15.5.27
  affected, 15.5.28 patched. This application uses App Router and Server Actions;
  upstream documents no workaround besides upgrading for that configuration.
- [Next.js 15.5.28 security release](https://github.com/vercel/next.js/releases/tag/v15.5.28)
  names both advisories. Published npm package metadata confirms Node 22 support
  and matching 15.5.28 framework/tooling packages. No Next 16 migration is needed.

These are two advisories against **one** production package, not two production
package findings. The original production report has one critical entry (`next`)
whose `via` lists both advisories. It is a genuine supported-version remediation,
not an audit transport/parser failure or an excuse to bypass policy.

Dependency commit: `00d2c77`. Every changed lockfile package:

| Package | Before → after | Reason |
| --- | --- | --- |
| `next` | 15.5.27 → 15.5.28 | Smallest patched supported release; root minimum `^15.5.28` |
| `@next/env` | 15.5.27 → 15.5.28 | Exact framework dependency |
| `eslint-config-next` | 15.5.27 → 15.5.28 | Align framework lint configuration; root minimum `^15.5.28` |
| `@next/eslint-plugin-next` | 15.5.27 → 15.5.28 | Exact lint-config dependency |
| `@next/swc-darwin-arm64`, `@next/swc-darwin-x64` | 15.5.27 → 15.5.28 | Exact optional compiler binaries |
| `@next/swc-linux-arm64-gnu`, `@next/swc-linux-arm64-musl` | 15.5.27 → 15.5.28 | Exact optional compiler binaries |
| `@next/swc-linux-x64-gnu`, `@next/swc-linux-x64-musl` | 15.5.27 → 15.5.28 | Exact optional compiler binaries |
| `@next/swc-win32-arm64-msvc`, `@next/swc-win32-x64-msvc` | 15.5.27 → 15.5.28 | Exact optional compiler binaries |

Only those 12 package entries and root Next minimums change semantically. The
Next entry also adopts upstream's patched sharp compatibility range; the resolved
sharp 0.35.5 and its existing override stay unchanged. npm 10's unrelated lockfile
key reordering was normalized back to the original order without changing its
generated JSON values. No unrelated dependency, override, audit rule or exception
was changed; no `audit fix --force` was used.

Toolchain: Node **22.23.3**, npm **10.9.9**, exact `npm ci`, fresh task-specific
cache. Baseline audit reproduced the production failure. Patched local audit:
**0 production / 0 full findings**. Original full audit: 9 package entries
(1 critical production, 8 high development); the latter are separate from Next.
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) was
officially **withdrawn on 2026-10-23**, explaining why fresh registry metadata no
longer returns those development entries even with the original lockfile. This is
not a development dependency fix. The existing development exception is preserved
unchanged; the policy still rejects every production finding and incompatible
unexpected audit metadata. [Local audit JSON](evidence/task25-ci/local/audit-full.json)
and [production JSON](evidence/task25-ci/local/audit-production.json) are retained.

## Reports history: wait for rendered state as well as URL

Browser commit: `0b92f09`. The old journey treated `page.goBack()`/`goForward()`
completion as React-render completion and immediately read the form's input.
App Router history can update the URL before React commits the keyed period
form. The original failure therefore required checking the navigation/render
boundary, not assuming infrastructure failure or adding retries.

The corrected journey waits, with explicit **15-second condition bounds**, for
the exact expected URL (including date and `context=keep`), exact input value,
selected period button and report heading before checking the calendar range.
No alternate period/date is accepted. It retains Month→Week→Month,
Year→Week→Year, keyboard activation, Back/Forward, reload, unrelated parameters,
cross-month/year references and independent canonical CSV assertions.

Each source now completes **three full Back/Forward round trips**, failing on
the first incorrect assertion; these are not failed-test retries. Each round
also reloads and rechecks the original period. Sanitized journey observations
record only synthetic expected dates and input values at popstate/navigation
return, followed by exact rendered-selection verification. This separates the
observable pre-render window from the settled application state. No app route,
period selection, metric formula, timeout/quota/security/cleanup gate is changed.
No sleep, blanket retry or skipped journey is added.

**Confirmed in real isolated Supabase:** at corrective head
`4026895edee072fcb74303d5f1335e26e04f62ca`,
[CI 40089668257](https://github.com/dfalidas/matter-stats/actions/runs/40089668257)
recorded the old control value **`2025` after Back returned**, before it settled
to the exact expected **`2025-01-01`**. The same old-value window was observed
for month→week (`2025-03` → `2025-03-01`) and Forward. Thus the previous immediate
assertion was demonstrably too early, rather than evidence of a persistent
application selection defect. All 12 history transitions passed after the
condition waits; all **44 journey checks**, **13 harness phases** and **7 real
SQL/Data API phase groups** passed. Browser page/console/resource/unexpected-
request counts were zero, real Matter requests zero, all owned cleanup verified.
[Inspected JSON and ZIP hashes](evidence/task25-ci/verified-4026895/provenance.json)
are retained at their actual identity. This earlier-head evidence is not a
substitute for checks on the final documentation-inclusive head.

## Verification and limits

Local baseline full-stack reproduction was attempted with the unmodified harness
and pinned CLI 2.48.3/Playwright 1.64.1. The first prerequisite failed because
nested npm lacked explicit proxy configuration; retrying with the existing
approved proxy fixed that prerequisite. Stack creation then exhausted the 32 GB
workspace while extracting the pinned Postgres image under Docker's `vfs` driver.
The owned CLI attempt was terminated; the existing runner recorded
**blocked / disk-capacity**, no app/browser created, owned stack/temp cleanup
verified. [Original-identity local evidence](evidence/task25-ci/local/baseline-browser-failure.json)
is retained; this is not a reproduced history assertion or a local SQL pass.
No storage-driver, image, CLI, gate or production setting was changed to bypass it.

Local patched-code checks started at `0b92f09`: locked install, route generation,
typecheck, lint (zero errors, three unchanged Visual Explainer warnings),
**403/403 tests** (zero failed/skipped/TODO), production build and audit policy
passed. In CI 40089668257 the `verify` and browser jobs also passed; the independent
DB job was still in progress when this evidence was recorded. `verify` used merge
commit `7baca097df8949c2d1be0be57a06e9eb7a702466`, whose tree is identical to head
4026895 (`b27c66d57049d843f2e0388cc88d44cd2c6d0357`); browser used clean PR head.
Both CI audit reports contain **zero findings**. No incomplete DB result is
counted as a pass. Adding this inspected evidence creates a new final head that
must independently complete all required jobs.

The final corrective head must pass all three unchanged CI jobs: `verify`,
`Fresh and upgrade database verification`, `Isolated browser and Supabase verification`.
Local resource limits do not count as passes. Final exact-SHA CI links, inspected
artifact outcomes/cleanup, local check results and the corrective head are recorded
in the corrective PR's verification receipt and dated Craft log; earlier head
success is never substituted for the final head. This also avoids treating this
document's own commit as having been tested before it exists.

Actual hosted staging, production deployment identity/configuration/migrations,
production backup/restore and two real scheduled deliveries remain the user's
separate v2.0 operational gates. No real Matter request, production cron/import,
migration, repair, generation change, secret rotation or manual deployment is
performed. Tasks 26–32 remain unstarted; 28 Conditional; Task 25 remains Review.

## Review, merge order and rollback

1. Keep both PRs draft/open/unmerged for review. Review the corrective PR and its
   final-head three-job evidence first; no runtime change is added to PR #88.
2. After approval, merge the corrective PR first and verify its actual main SHA,
   required checks and retained cleanup evidence.
3. Then update PR #88 against that main, refresh its baseline/verification notes,
   retain the original failed evidence, and run all required checks at its new
   final head. Review its documentation-only diff and exact-head evidence before
   marking ready and merging it. Neither merge is performed by this task.

Rollback requires no database/environment undo. Revert the browser commit alone
to restore the previous test (and its unsafe synchronization). Reverting the
dependency commit restores a known vulnerable Next baseline, so prefer a reviewed
roll-forward. If application rollback is necessary under the separate release
workflow, select a supported patched application SHA and rerun required checks;
do not disable audit, remove assertions or deploy the vulnerable baseline as a
security workaround.
