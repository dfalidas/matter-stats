# Historical dependency evidence

Archived from main `323b2d5d956312b7973484b5e5c3f37c14afb9be` on 2026-10-20.
The dates, versions and outcomes below retain their original historical scope.
Current operations: [release runbook](../security-release-runbook.md). These results do not certify a later SHA.

## W2 dependency baseline update (completed 2026-10-03)

**Status: complete for applicable critical/high findings.** The registry and
audit service were reachable. Next.js and `eslint-config-next` remain on the
reviewed 15.5.27 line. npm regenerated the lock after applying the smallest
compatible fixes available in the existing major lines. The manifest enforces
Node.js 20.9.0 or newer because patched sharp 0.35.x requires that runtime.

The PostCSS override is intentionally scoped to the package name and references
the root `postcss` spec (`$postcss`). This replaces Next.js's exact vulnerable
8.4.31 transitive pin with the same PostCSS 8 API used by the root build tool.
The sharp override selects 0.35.4, which Next.js 15.5.27 explicitly permits via
`^0.34.3 || ^0.35.4`. Both overrides were resolved by npm; no lockfile integrity
value was written manually.

### Advisory disposition

| Identifier(s) | Dependency path and versions | Affected / patched | Application use and exploit prerequisite | Resolution |
| --- | --- | --- | --- | --- |
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) | `next > sharp`, 0.34.5 → 0.35.4 | `<0.35.0` / `0.35.0`; `<0.35.4` / `0.35.4` | Next.js image optimization can decode external image bytes. Exploitation requires a crafted image reaching a vulnerable libvips/libheif decoder; therefore this is runtime-applicable even though sharp is optional. | Fixed at 0.35.4. A native smoke test decodes and resizes a generated PNG. Node `>=20.9.0` is now enforced. |
| [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | `next > postcss` 8.4.31 and root/Tailwind PostCSS 8.5.14 → one overridden 8.5.23 | `<8.5.10` / `8.5.10`; `<=8.5.11` / `8.5.12`; `<=8.5.22` / `8.5.23`; `<=8.5.17` / `8.5.18` | CSS serialization XSS requires unsafe output insertion; file disclosure issues require attacker-controlled CSS/source-map comments during compilation. Application styles are repository-controlled, but the package is used by the production build and was treated as applicable. | Fixed at 8.5.23 across every locked path. The production build and a direct Tailwind compilation validate the override. |
| [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | `postcss > nanoid`, 3.3.12 → 3.3.19 | `<3.3.16` / `3.3.16`; `<3.3.18` / `3.3.18` | A denial of service requires passing attacker-controlled negative or zero sizes to Nano ID's non-secure/custom generator. The application does not call Nano ID; PostCSS uses it internally while generating source-map identifiers. | Fixed at 3.3.19 within major 3. |
| [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68), [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m), [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj), [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) | `@eslint/eslintrc > js-yaml`, 4.1.1 → 4.3.2 | `<=4.1.1` / `4.2.0`; `<4.3.0` / `4.3.0`; `<4.3.1` / `4.3.1`; `<4.3.2` / `4.3.2` | CPU denial of service requires parsing malicious YAML aliases, merge chains, or `!!omap` input. ESLint is build-only and this repository's flat config does not parse user-provided YAML. | Fixed at 4.3.2 within major 4. |
| [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp), [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895), [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | `@eslint/eslintrc > minimatch > brace-expansion` 1.1.14 → 1.1.21; `@typescript-eslint/typescript-estree > minimatch > brace-expansion` 5.0.6 → 5.0.12 | npm's audited ranges end at 1.1.20 and 5.0.11; fixed by 1.1.21 and 5.0.12 | Resource exhaustion requires malicious brace patterns. These paths process repository-controlled lint file patterns, not request data. | Fixed on both locked major lines. |
| [GHSA-w9m9-85wc-3x92](https://github.com/advisories/GHSA-w9m9-85wc-3x92) | `tailwindcss > postcss-selector-parser`, 6.1.2 → 6.1.4 | `>=6.1.0 <6.1.3` / `6.1.3` | Stack exhaustion requires a malicious deeply nested CSS selector during compilation. Styles are repository-controlled, but CSS compilation is a required build path. | Fixed at 6.1.4 within major 6. |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `tailwindcss > chokidar/fast-glob/micromatch > braces`, 3.0.3 | `<=3.0.3`; no patched release exists | Stack exhaustion requires an attacker to supply a deeply nested brace glob. The only Tailwind content globs are three static literals in `tailwind.config.ts`; ESLint likewise uses static repository configuration. No request, Matter, database, or other user-controlled value reaches these build-only glob APIs. | Residual audit finding accepted as **not application-exploitable** pending an upstream patched `braces` release. It is absent from `npm audit --omit=dev`; replacing it currently requires an unsupported/unavailable package change, so no forced downgrade or major upgrade was applied. |

### Final verification

- `npm ci`: exit 0; 505 packages installed from the lock.
- `npm audit --json`: exit 1; 8 high entries, all propagation from the single
  unpatched build-only `braces` advisory described above.
- `npm audit --omit=dev --json`: exit 0; 0 vulnerabilities.
- `npm run typecheck`, `npm run lint`, and `npm run build`: exit 0.
- `npm run test`: exit 0; 105 total, 98 passed, 0 failed, and 7 pre-existing
  stabilization TODO tests.
- Direct sharp PNG decode/resize and direct Tailwind CSS compilation: exit 0.
- `git diff --check`: exit 0.

There are no unresolved applicable critical/high findings. The only remaining
high advisory has no patched release and is isolated to development/build glob
processing with static, repository-controlled patterns. Re-run both audits when
`braces` publishes a fix or Tailwind's dependency graph changes.

## Task 13 sharp advisory follow-up

Task 13's 2026-10-07 dependency follow-up updates the current sharp override to
0.35.5 to fix [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
The W2 version/results above are historical. Next.js remains 15.5.27; the existing
Tailwind selector override and audit policy are unchanged, with no new advisory
exceptions. npm regenerated the sharp/platform/libvips lock entries, a native
PNG decode/resize smoke check passed, and production audit reports zero findings.
See [task-13-validation.md](../task-13-validation.md) for actual tested SHAs, full
CI/disposable results, gateway investigation and cleanup evidence.

