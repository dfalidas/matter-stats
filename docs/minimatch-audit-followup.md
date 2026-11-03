# PR #92: remove legacy minimatch consumers while preserving lint checks

## Verified baseline and fresh official sources (2026-11-03)

Reviewed head `a986b5cade8647f421f935553a6c56b016e2209b`, current main
`c7ac54a81f9eddeae3a3d14bc398e68437be40cf`, and #91 head
`29e7340b8dc7fe734c00dd4af11f00ead2c264ab` were rechecked remotely.
#91 remains independent, draft and unchanged. AGENTS.md, the #92 diff, workflow,
audit implementation and [CI 41615205672](https://github.com/dfalidas/matter-stats/actions/runs/41615205672)
were reread: application/tests/build and isolated DB/browser passed; audit failed.

A new writable npm cache separate from the previous/default cache was used with
exact CI **Node 22.23.4 / npm 10.9.9**. Fresh npm ci/audit reproduced **13 moderate
package finding entries / one unique advisory**, GHSA-g3hv-75wg-m249. Production:
**0 package entries / 0 advisories**. Propagated parent package entries are not
13 different advisories. [Baseline reports and fresh source snapshots](evidence/minimatch-audit/followup-2026-11-03/).

- [GitHub advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249), updated
  2026-10-30: affected **<11.0.1**, first patched **11.0.1**.
- [Maintainer advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249),
  updated 2026-10-29: affected **10.2.6**, patched **11.0.1**. Description concerns
  globparts amplification at optimizationLevel >=2. The discrepancy persists;
  it was not filtered, treated as resolved or granted a local exception.
- npm dist-tags still identify legacy-v3 **3.1.5**, legacy-v9 **9.0.9**, latest
  **11.0.4**; 10.x still ends at 10.2.6. No compatible audited backport appeared.
- Published React **7.37.5**, imports **2.32.0**, accessibility **6.10.2** still
  declare minimatch **^3.1.2**. Latest eslintrc **3.3.7** and ESLint maintenance
  **9.39.5** still install 3.x. Their published peers do not support ESLint 10.
- Default branch manifests were also checked: React master/import main use
  ^3.1.5, jsx-a11y main ^3.1.2. No reviewed upstream API migration is available
  there to pin instead of a release. Next/config 16 still includes the old
  consumers, so a framework upgrade would add scope without fixing the graph.

## Resulting supported toolchain

The remaining 3.x consumers are removed. All four remaining minimatch consumers
resolve **11.0.1** using narrowly scoped, individually tested overrides. Production
framework/application packages and audit policy are unchanged.

| Change | Node / peers / API compatibility |
| --- | --- |
| ESLint 9.39.4 → **10.14.0**; remove FlatCompat/@eslint/eslintrc and eslint-config-next | ESLint 10 removes eslintrc. Requires Node ^20.19, ^22.13 or >=24; CI 22.23.4 satisfies it. Native flat configuration imports direct maintained plugins. |
| Direct **@next/eslint-plugin-next 15.5.28** | Matches unchanged Next 15.5.28. No declared ESLint peer restriction. All former Next/recommended/core-web-vitals severities/options retained; no framework upgrade and no lint suppression in Next config. |
| Direct **@typescript-eslint/parser/eslint-plugin 8.59.3** | Same resolved versions as before; peers ESLint ^8.57/^9/^10 and TS >=4.8.4 <6.1. Preserve recommended rules, current warning overrides and the four TS-only core rules. |
| Hooks 5.2.0 → **7.1.1** | Old peer stops at ESLint 9; new peer includes 10. Keep rules-of-hooks error / exhaustive-deps warning, rather than importing unrelated compiler rules from a new preset. |
| jsx-a11y 6.10.2 → maintained **eslint-plugin-jsx-a11y-x 0.2.0** | Node ^20.9 or >=21.1; peers ESLint ^9/^10. Same active Image/ARIA rules and options, same warning severities. Its custom-control matching uses named minimatch API. |
| React and import plugins → maintained **Oxlint 1.91.0**, plus supported ESLint core guards | Node ^20.19 or >=22.12; native platform packages. Native implementations retain 14 active React checks and import/no-anonymous-default-export. Old JSX usage marking is covered by the TS parser/modern scope analysis; obsolete React APIs use built-in configuration guards described below. |
| Direct **globals 14.0.0** | Existing resolved globals version, promoted from eslintrc's dependency. Preserve browser/node globals. |

ESLint, @eslint/config-array 0.23.5, typescript-estree 8.59.3 and jsx-a11y-x
0.2.0 each declare minimatch 10.x ranges but use retained named minimatch or
Minimatch class APIs. Each receives a parent-scoped **11.0.1** override, the first
patched version. Direct CJS/ESM/class/function tests, file globs/exclusions,
parser projectService and actual accessibility rules exercise these APIs. There
is no global minimatch override. Existing postcss/sharp/selector overrides remain.

The lint toolchain needs **Node >=22.13 within the project's Node 22 line**.
The current CI version meets that requirement. Application engines remain 22.x;
no production Node or environment setting was changed. The native linter adds
platform-specific development packages; npm ci selects the supported CI platform.

### All old checks accounted for

The [baseline inventory](evidence/minimatch-audit/followup-2026-11-03/active-rules.json)
records enabled rules/options in TSX, TS, JS config and an existing skill TS file.
A CI test compares every former active rule's severity/options against its current
engine or replacement. TS-only no-var/prefer-const/prefer-rest-params/prefer-spread
remain TS-only. No rule is switched off or reduced to get the application through.

- `npm run lint` requires **ESLint and Oxlint**. The explicit native rule whitelist
  represents the former React/import checks; unrelated new-engine default rules
  are not imported. This does not suppress any former enabled check.
- `npm run build` runs the **full lint gate before next build**, preserving both
  engines and propagating configuration failures. Next's own lint integration
  still runs. No ignoreDuringBuilds or skipped lint step was introduced.
- Accessibility keeps the existing `jsx-a11y` config namespace via ESLint's
  supported plugin alias mechanism. Import's active warning is implemented by
  the native import rule. Optional forbidden path globs can use standard ESLint
  no-restricted-imports; side-effect allow globs remain available natively.
- `eslint.react-deprecations.mjs` configures **no-restricted-properties** and
  **no-restricted-syntax**, with React 19 obsolete member names, named imports,
  CommonJS destructuring, addons and lifecycle method names. It contains no
  custom ESLint rule implementation, dependency adaptor or vendored rule source.
  Namespace imports remain valid. These supported core guards replace the old
  react/no-deprecated behavior checked against the recorded baseline below.
- The lifecycle-name guard deliberately reserves obsolete lifecycle names on
  every class/object method, including fields/factories/JSDoc-only components.
  This is stricter than the former component-recognition heuristic: unrelated
  classes using those reserved names would also be reported. Current source has
  no such violation; this broader guard prevents a coverage gap and is explicit
  project lint policy, not a compatibility shim.
- `.jsx` files are now explicitly included as well as JS/TS/TSX. The old CLI
  config did not match a standalone .jsx file. Existing generated-output ignores
  remain. Native VCS-ignore handling concerns scratch/generated files; tracked
  application and skill sources remain covered (including the existing warning).

## Compatibility validation beyond today's application

Nine focused test groups run in ordinary npm test/CI and standalone validation:

1. **116 frozen legacy React invalid/valid pairs**, recorded by actual ESLint
   9/react 7 at clean `97447f9ab4e5e539ece76593bcc4eb795584f3f8`. They cover every
   migrated React check, PascalCase wildcard ignores, nested render* props,
   member/named import/CommonJS deprecations, aliases, addons and lifecycles.
2. **11 default-export shapes**, preserving the exact import warning contract,
   including allowed calls/named declarations and disallowed anonymous/new/literal
   exports; plus side-effect import allow-glob controls.
3. **12 JS/TSX reference/scope cases**, including React imports, component and
   namespace usage, unused bindings and forbidden global JSX namespaces.
4. All six active Image/ARIA accessibility rules, and optional custom-control
   wildcard label association, each with valid/invalid controls.
5. Actual Next, Hooks, TypeScript and standard import-restriction paths.
6. Actual native flat-config file matching/exclusions and original TS-only scope.
7. All four minimatch consumers' **CJS/ESM named/class APIs**, and no legacy
   minimatch in the lockfile. The removed top-level makeRe is not used.
8. Actual parser **projectService/allowDefaultProject** with type information.
9. Baseline per-file rule severity/options comparison and an invalid native CLI
   input that must fail the process, proving the new gate is active.

The frozen oracles were obtained before removing the old packages; their source
SHA and observed diagnostics are in evidence. They are not generated from the
new guard implementation. This is substantial regression evidence, not a formal
proof of identical diagnostics for every possible program. Existing application
lint still has the same three pre-existing warnings and zero errors.

## Rejected alternatives and observed failures

- Blanket minimatch 11 override: legacy callable/default imports and makeRe fail.
- Direct @eslint-react/eslint-plugin 5.28.8 recommended-preset replacement:
  **React.createClass / React.PropTypes were missed**, while the old rule errored.
  The current explicit core guards close that demonstrated gap. Merely choosing
  a maintained package's preset was insufficient.
- import-x **4.17.1** with minimatch 11: scratch audit had **0 findings**, but lint
  failed to load with `SyntaxError: ... does not provide an export named makeRe`.
  11.0.1–11.0.4 all lack that export. This rejected candidate was never adopted;
  the native import rule avoids an adapter or unsupported patch.
- Initial no-restricted-imports deprecation guard also rejected valid namespace
  imports. It was replaced with supported ImportSpecifier syntax selectors and
  positive controls, rather than changing application imports or suppressing
  diagnostics.

[Rejected probe evidence](evidence/minimatch-audit/followup-2026-11-03/rejected-migration-probes.json)
and [modern React preset output](evidence/minimatch-audit/followup-2026-11-03/react-parity-probe.json)
retain these failures separately. The historical parity script takes an old
baseline checkout and isolated probe installation; it is not invoked by current
application lint/tests and its candidate packages are not root dependencies.

## Production dependency stability and lock provenance

All **210 normalized production dependency/optional edges** retain identical
versions, resolved URLs and integrities, including Next/React/Supabase/sharp.
[Comparison](evidence/minimatch-audit/followup-2026-11-03/production-graph-comparison.json).
New Babel tooling for Hooks needs a newer development caniuse-lite. npm initially
hoisted that over Next's existing version. Targeted npm resolution retained Next's
allowed **1.0.30001792** in a nested lock entry; the newer **1.0.30001820** is used
only by the new dev Browserslist path. No caniuse override remains in the manifest.
The resulting exact lock passes npm ci without the temporary resolution constraint.
No integrity/version was written by hand; restoring JSON key order preserved
npm-generated values and semantic equality was asserted.

## Release and verification provenance

Exact-commit local checks and final-head CI are recorded below/in the PR
conversation and existing Craft tracker. Audit reports count package findings
and unique advisories separately. Policy/parser/threshold/exception tests remain
unchanged; no audit fix --force, new exception, rule disable, shim or vendored
patch was used.

The dependency blocker is resolved only when the unchanged audit gate and all
final-head CI jobs pass. This does **not** certify a release of #91: after review
and combining the changes, rerun its complete then-current test suite, build,
audit and fresh/upgrade/browser CI at the actual combined head. #91's historical
409 count is not the new combined count; the added test groups must also run.

No #91 functional change, framework upgrade, merge, manual deployment, production
migration, real Matter sync or production data/configuration action is included.
Existing CI database migrations run only in disposable synthetic test resources.
