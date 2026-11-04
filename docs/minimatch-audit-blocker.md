# PR #91 dependency audit investigation (2026-11-03)

Current follow-up: [native lint migration, complete rule mapping, rejected probes and validation](minimatch-audit-followup.md). The original results below refer to reviewed head a986b5cade8647f421f935553a6c56b016e2209b; they remain historical evidence, not a claim that the blocker is resolved.

## Baseline and policy

Main is `c7ac54a81f9eddeae3a3d14bc398e68437be40cf`; PR #91 remains
`29e7340b8dc7fe734c00dd4af11f00ead2c264ab`. Their package-lock.json files are
identical (SHA-256 `7772686b175acaa8f9d14371b1aafb1ff7d8956a41450d9fa5d40d3d910ef2b7`).
This dependency-only branch starts at main and contains none of #91's runtime changes.

[CI 41197278653](https://github.com/dfalidas/matter-stats/actions/runs/41197278653)
used Node 22.23.4/npm 10.9.9. The same versions reproduce the unchanged policy
failure: **14 moderate development entries, 0 production findings**. See
[evidence](evidence/minimatch-audit/baseline-full.json) and
[production report](evidence/minimatch-audit/baseline-production.json).
The policy rejects findings outside its pre-existing braces advisory and requires
zero production findings; neither policy nor exception is changed here.

## Official sources and all affected chains

- [GitHub advisory GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
  (CVE-2026-118764) and npm audit mark **all minimatch <11.0.1** affected.
- [Maintainer advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)
  specifically describes 10.2.6, `optimizationLevel >= 2`, repeated globparts
  amplification followed by quadratic pairwise work; patched version 11.0.1.
  Its narrower description does not authorize ignoring the broader audit range.
- [Maintainer patch](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8)
  and [11.0.1 release](https://github.com/isaacs/minimatch/releases/tag/v11.0.1).
- Published npm manifests/tarballs: `npm view minimatch@11.0.1`,
  `npm view minimatch dist-tags`, `npm view <consumer>@<version> dependencies`.
  Legacy-v3 is still 3.1.5; the 10.x line ends at 10.2.6. Neither escapes the
  audited range. 11.0.1 supports Node `18 || 20 || >=22`, CommonJS named exports
  and ESM named exports. Its dependencies are brace-expansion `^5.0.12` and
  @isaacs/nonrecursive-glob-match `^1.0.1`.

The complete installed consumer tree is in [baseline chains](evidence/minimatch-audit/baseline-chains.txt).
Every consumer edge in the lockfile is listed below; all are development-only.

| Root and chain | Consumer version | Declared minimatch range | Locked version |
| --- | --- | --- | --- |
| @eslint/eslintrc | 3.3.5 | ^3.1.5 | 3.1.5 |
| eslint > @eslint/eslintrc (deduped root) | 9.39.4 > 3.3.5 | ^3.1.5 | 3.1.5 |
| eslint | 9.39.4 | ^3.1.5 | 3.1.5 |
| eslint > @eslint/config-array | 0.21.2 | ^3.1.5 | 3.1.5 |
| eslint-config-next > eslint-plugin-import | 2.32.0 | ^3.1.2 | 3.1.5 |
| eslint-config-next > eslint-plugin-jsx-a11y | 6.10.2 | ^3.1.2 | 3.1.5 |
| eslint-config-next > eslint-plugin-react | 7.37.5 | ^3.1.2 | 3.1.5 |
| eslint-config-next > @typescript-eslint/parser > typescript-estree | 8.59.3 | ^10.2.2 | 10.2.5 |
| eslint-config-next > @typescript-eslint/eslint-plugin > type-utils/utils > typescript-estree (deduped) | 8.59.3 | ^10.2.2 | 10.2.5 |

Audit also propagates the finding to @eslint-community/eslint-utils and
@typescript-eslint/{eslint-plugin,parser,type-utils,utils}; these are not additional
physical minimatch copies. Audit finding counts are package entries, not CVE counts.

## Compatibility decision before changing dependencies

A blanket override to 11.0.1 is **incompatible**. The 3.x package is a callable
CommonJS export and exposes makeRe. Published 11.0.1 exports an object with named
minimatch, has no makeRe export and no ESM default export. Import/react/jsx-a11y
plugins invoke the callable directly; @eslint/eslintrc and config-array also have
ESM default imports. Passing the default lint configuration alone would not prove
all optional plugin rule paths compatible. No shim, vendored fork, disabled rule,
policy exception or force fix is justified.

Latest published consumers were inspected as well: eslint 10.14.0 still declares
minimatch ^10.2.6; @eslint/config-array 0.23.5 declares ^10.2.4;
@typescript-eslint/typescript-estree 8.72.1 declares ^10.2.2; latest import 2.32.0,
react 7.37.5 and jsx-a11y 6.10.2 retain the callable 3.x dependency. Broad direct
upgrades would add unrelated changes without removing the blocker.

The sole reviewed override is scoped to
`@typescript-eslint/typescript-estree > minimatch` at **11.0.1**, the first patched
release. Its only runtime import/call is named `.minimatch(filePath, pattern,
{ dot: true })` in useProgramFromProjectService.js, retained by 11.0.1. This crosses
the declared major range and is an application-reviewed override, not an upstream
consumer-supported semver resolution. Other consumers remain on their existing
API. Required checks: direct CJS/ESM export and matching cases, actual parser
project-service allowDefaultProject path, clean npm ci, route generation,
typecheck, full lint, all application tests, production build, unchanged audit;
then final-head CI including isolated fresh/upgrade DB and browser jobs.

This is a **partial remediation**, not resolution of the release blocker.
The remaining 3.x chains require upstream patched compatible releases and updated
audit metadata, or consumer releases that explicitly support a patched major API.
Review the discrepancy between the maintainer's narrow description and broad
GitHub/npm version range upstream; do not suppress it locally.

## Local results on CI toolchain

Node **22.23.4**, npm **10.9.9**, NEXT_TELEMETRY_DISABLED=1. Exact reordered
npm-generated lockfile: npm ci passed (459 packages); only the minimatch entry
changes and @isaacs/nonrecursive-glob-match **1.0.3** is added. Existing
brace-expansion 5.0.12 already satisfies the patched requirement. JSON key ordering
was restored to the baseline for review; npm's metadata/integrities were preserved
and semantic equality asserted. No runtime dependency changed.

| Check | Result |
| --- | --- |
| `npm ci` | PASS, including reinstall from final lockfile |
| `npx --no-install next typegen` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, 0 errors / 3 existing warnings |
| `npm run test` | PASS, 403/403, 0 failed/cancelled/skipped/TODO |
| `npm run build` | PASS on sequential final run |
| `node docs/evidence/minimatch-audit/compatibility.mjs` | PASS: CJS/ESM exports, 10 glob cases and actual parser default-project/type-information path |
| `npm run audit:ci` | **FAIL**, 13 moderate development entries, production 0 |
| `git diff --check` | PASS |

[Final audit](evidence/minimatch-audit/patched-full.json) identifies only
`node_modules/minimatch` 3.1.5; the estree nested copy is remediated.
[Production audit](evidence/minimatch-audit/patched-production.json) is empty.
This branch has 403 tests because it starts from main; the six extra tests of #91
are deliberately outside this change and require a later combined-head run.

Attempt history: the first build failed with missing modules because a local
npm ci overlapped it; it is not a valid build verdict. A subsequent, sequential
build passed. The first lint of the newly added evidence script rejected CJS
require-style imports; the script now uses standard ESM imports with createRequire
to exercise the dependency's CJS API. Final lint and compatibility checks passed.
No application checks or lint rules were removed or relaxed. Command exit records
are retained in [first attempt](evidence/minimatch-audit/local-attempt1-results.json)
and [final reruns](evidence/minimatch-audit/local-final-results.json).

## CI and next release gate

The draft PR's description and existing Craft tracker record the final commit,
actual CI run and job outcomes after completion. Local DB/browser integration was
not run; the unchanged CI executes both against disposable resources and synthetic
Matter fixtures. No hosted/production check is claimed by these local results.

Before #91 can be reconsidered: obtain an API-compatible upstream fix for all
remaining 3.x consumers (or corrected official advisory metadata, without a local
exception), pass unchanged audit:ci, review the separate dependency change, then
combine it with #91 under the normal review/merge workflow and rerun all checks
on that exact head, including its 409 tests and fresh/upgrade/browser CI. Successful
partial-remediation CI steps do not unblock #91 while audit fails.

No merge, manual deployment, migration, real Matter sync, production read/write,
or production configuration change was performed.
