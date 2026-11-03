# PR #92 follow-up: blocker remains (2026-11-03)

## Verified baseline and fresh investigation

Reviewed head `a986b5cade8647f421f935553a6c56b016e2209b`, current main
`c7ac54a81f9eddeae3a3d14bc398e68437be40cf`, and #91 head
`29e7340b8dc7fe734c00dd4af11f00ead2c264ab` were rechecked remotely.
Both PRs remain draft, and #91 is unchanged. The existing #92 diff, AGENTS.md,
workflow and unchanged audit-policy implementation were reread.
[CI 41615205672](https://github.com/dfalidas/matter-stats/actions/runs/41615205672)
completed with application/tests/build and isolated DB/browser success; audit failed.

A new writable npm cache, separate from the previous task and default cache, was
used with exact CI Node **22.23.4 / npm 10.9.9**. Fresh `npm ci` and `audit:ci`
reproduce **13 moderate package finding entries / one unique advisory**,
GHSA-g3hv-75wg-m249. Production audit: **0 package findings / 0 advisories**.
Package entries include propagated parent findings; they are not 13 distinct CVEs.
[Full report](evidence/minimatch-audit/followup-2026-11-03/baseline-full.json),
[production](evidence/minimatch-audit/followup-2026-11-03/baseline-production.json).

Fresh official source snapshots and npm manifests are retained in
[evidence](evidence/minimatch-audit/followup-2026-11-03/):

- [GitHub advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249), updated
  2026-10-30: range **<11.0.1**, first patched **11.0.1**.
- [Maintainer advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249),
  updated 2026-10-29: affected **10.2.6**, patched **11.0.1**. Description concerns
  globparts amplification at optimizationLevel >=2. The discrepancy persists;
  it was not assumed resolved, filtered or granted a local exception.
- npm dist-tags still identify legacy-v3 **3.1.5**, legacy-v9 **9.0.9**, latest
  **11.0.4**. No new compatible 3.x backport is published. 10.x still ends at
  10.2.6. Neither legacy line escapes the official audited range.
- Latest published React **7.37.5**, imports **2.32.0**, accessibility **6.10.2**
  still depend on minimatch **^3.1.2**. @eslint/eslintrc **3.3.7** uses **^3.1.5**;
  ESLint maintenance **9.39.5** still includes eslintrc and minimatch 3.
- Upstream default branches were also checked: React master 7.37.5 and import
  main 2.32.0 declare ^3.1.5; jsx-a11y main 6.10.2 declares ^3.1.2.
  There is no reviewed upstream API migration there to pin instead of a release.

No further dependency change is justified by those results. The existing scoped
estree override remains a partial fix. A newer Next framework/config package
would retain the old React/import/a11y consumers, so it would not solve this issue.

## Evaluated native-flat-config migration

Removing FlatCompat alone is insufficient: ESLint 9 itself still installs eslintrc
and minimatch 3. A full migration must address the engine and all consumers.

| Candidate | Node / peer requirements | API and migration implications |
| --- | --- | --- |
| ESLint 10.14.0 | Node ^20.19.0, ^22.13.0 or >=24; CI 22.23.4 qualifies | Removes eslintrc; native flat configuration and intrinsic JSX scope handling. Still declares minimatch ^10.2.6; config-array 0.23.5 declares ^10.2.4, requiring separately reviewed scoped 11.x overrides. |
| Direct @next/eslint-plugin-next 15.5.28 | Same framework release; no declared ESLint peer restriction | Retains existing Next/core-web-vitals rules without upgrading Next. Must explicitly preserve rules/options and browser/node globals previously supplied by eslint-config-next. Next 15 build integration must be tested with the new engine. |
| TypeScript parser/plugin 8.59.3 | ESLint ^8.57, ^9 or ^10; TypeScript >=4.8.4 <6.1 | Already supports ESLint 10 by published peers; existing reviewed estree override still needed. Preserve recommended rules and current warning overrides exactly. |
| Hooks 7.1.1 | ESLint through ^10; current 5.2.0 stops at ^9 | Engine peer upgrade necessary. Preserve rules-of-hooks error and exhaustive-deps warning; a preset swap can add unrelated compiler rules. |
| import-x 4.17.1 | Node ^18.18, ^20.9 or >=21.1; ESLint ^8.57/^9/^10 | Maintained named minimatch API (^9 or ^10); scoped 11 override needs tests. Rename plugin/resolver namespaces; preserve no-anonymous-default-export and validate pathGroups/internal-module glob options. |
| jsx-a11y-x 0.2.0 | Node ^20.9 or >=21.1; ESLint ^9/^10 | Maintained fork using minimatch ^10.2.5, with named API. Scoped 11 override and checks for custom controls/labels/ARIA/Image mappings required. Its newer upstream source is not itself a released audit-clean package. |
| @eslint-react/eslint-plugin 5.28.8 | Node >=20.19; ESLint/TypeScript peers '*' | ESM-only package exports; maintained but not a drop-in replacement for react/recommended. Rule names/options/coverage differ; retaining only its recommended preset loses real baseline checks. |
| Oxlint 1.91.0 for React | Node ^20.19 or >=22.12; platform native packages | Covers many legacy React rules, but its published rule schema lacks react/no-deprecated and the two JSX scope-marking rules. Requires a separate lint/build gate plus semantic validation of JSX reference tracking. Cannot just replace the current React preset. |

The [enabled rule inventory](evidence/minimatch-audit/followup-2026-11-03/active-rules.json)
was captured for TSX, TypeScript, JavaScript config and an existing skill TS file.
Next, Hooks, TypeScript, imports and accessibility all have explicit preservation
requirements; no rule was removed, disabled or reduced in severity.

### Concrete rule-parity failure, including valid controls

A scratch installation outside the repository used ESLint 10.14.0 and maintained
@eslint-react/eslint-plugin 5.28.8. The comparison runs the actual legacy
react/no-deprecated and actual candidate recommended preset, not text matching:

| Fixture | Existing rule | Modern recommended preset |
| --- | --- | --- |
| React.createClass(...) | error | no diagnostic |
| React.PropTypes | error | no diagnostic |
| componentWillMount lifecycle | error | error under new rule |
| Valid function component | no diagnostic | no diagnostic |

[Actual output](evidence/minimatch-audit/followup-2026-11-03/react-parity-probe.json)
and [reproduction script](evidence/minimatch-audit/followup-2026-11-03/react-parity-probe.mjs).
This rejects the simple preset substitution; it is not a claim that every possible
custom migration is impossible. A broader migration would need an explicit,
maintained replacement for all legacy deprecation checks, plus JSX/global/scope
parity. Hand-building a replacement rule or vendoring the old rule is not the
minimal supported dependency fix and was not introduced.

Reproduce with the CI toolchain and an isolated writable cache (paths may vary):

```sh
mkdir -p work/npm-cache-pr92
export npm_config_cache="$PWD/work/npm-cache-pr92"
npm install --prefix work/lint-probe --ignore-scripts --no-audit eslint@10.14.0 @eslint-react/eslint-plugin@5.28.8
node docs/evidence/minimatch-audit/followup-2026-11-03/react-parity-probe.mjs . work/lint-probe
```

Probe dependencies are not application dependencies and are not committed in the
root manifest/lockfile. The candidate output is evidence of rejection, not a pass.

## Compatibility guards added without weakening application lint

`tests/lint-dependency-compatibility.test.mjs` adds nine focused tests to ordinary
CI. They exercise actual Linter/plugin APIs with valid and invalid controls:

- React PascalCase glob ignores and nested render* props;
- imports' internal-module makeRe path and side-effect import allow globs;
- accessibility custom-control glob matching with label validation;
- eslintrc override glob/exclusion and config-array file matching;
- active Next, React, Hooks, TypeScript, import and accessibility rule families;
- legacy deprecation APIs missing from the migration candidate;
- callable/makeRe legacy API versus the patched estree named API, explicitly
  rejecting the incompatible substitution.

These tests do not add those optional rules to application lint or suppress any
existing diagnostics. The existing parser projectService probe also remains in
focused validation. An initial new FlatCompat test supplied a relative filename;
its API requires an absolute path. The fixture was corrected and all nine passed.
No dependency or application implementation was changed to accommodate the test.

## Options and recommendation

| Path | Required change | Tradeoff / release status |
| --- | --- | --- |
| **Recommended: official range correction or compatible backport** | Maintainer/GitHub/npm resolve the 10.2.6-versus-<11.0.1 discrepancy, or publish compatible audited backports. Then refresh audit using unchanged policy and exact CI toolchain. | Smallest application/toolchain risk; depends on an upstream action. Current metadata still blocks release. No claim of non-exploitability overrides the policy. |
| Consumer migration with complete rule parity | ESLint 10 native flat config, direct Next 15 plugin, peer-compatible Hooks, import-x/a11y-x, reviewed named-API minimatch overrides, and a maintained React rule replacement covering the demonstrated missing cases. Verify globals/options, all active rules and optional glob paths with positive/negative fixtures. | Larger lint toolchain change; currently no demonstrated lossless drop-in React replacement. Requires a separate explicit parity implementation/review, not merely green lint on today's application. |
| Wait for upstream consumers | Updated React/import/a11y/eslintrc/ESLint maintenance releases must use compatible patched minimatch or acknowledge corrected official ranges. | Minimal local changes, external timing. Latest packages/default branches do not currently provide this route. |

**Blocker remains.** Keep #92 draft; do not merge or release #91 on the strength
of partial remediation. Before #91 release, review a complete dependency solution,
pass unchanged audit policy with production zero, then rerun the complete combined
code at its actual head (including #91-specific tests and fresh/upgrade/browser CI).
This follow-up adds nine guard tests to main's 403; combined #91 counts will differ
from its historical 409 and must be recorded from execution, not inferred.

## Validation provenance

Fresh sequential local results are retained alongside this document's evidence.
The final PR description and existing Craft tracker record actual final-head CI
and tested SHAs, including merge SHA for verify and exact PR head for DB/browser.
Audit failures remain failures. No framework, functional #91, audit policy,
threshold, exception, production, migration-file or workflow change is included.
No merge, manual deployment, production migration or real Matter sync is authorized
or performed. Existing DB CI runs only against disposable synthetic environments.
