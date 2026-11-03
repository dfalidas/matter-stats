import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { ESLint, Linter } from "eslint";
import { lintNative, lintProduction, lintRules, nativeConfig, probeProjectService, root } from "../scripts/lint-compatibility.mjs";

const require = createRequire(import.meta.url);
const evidence = new URL("../docs/evidence/minimatch-audit/followup-2026-11-03/", import.meta.url);
const oracle = JSON.parse(readFileSync(new URL("react-rule-oracle.json", evidence), "utf8"));
const importScope = JSON.parse(readFileSync(new URL("import-scope-oracle.json", evidence), "utf8"));
const active = JSON.parse(readFileSync(new URL("active-rules.json", evidence), "utf8"));
const deprecationIds = new Set(["no-restricted-properties", "no-restricted-syntax"]);

function checkPair(rule, options, valid, invalid) {
  const rules = { [rule]: ["error", ...options] };
  assert.deepEqual(lintRules(valid, rules), [], `${rule}: valid control`);
  const messages = lintRules(invalid, rules);
  assert.ok(messages.some(message => message.ruleId === rule), `${rule}: invalid case must report the rule`);
  assert.ok(messages.every(message => !message.fatal));
}

test("all 116 frozen legacy React pairs retain detection and valid controls", async () => {
  assert.equal(oracle.cases.length, 116);
  for (const [index, fixture] of oracle.cases.entries()) {
    let invalid, valid;
    if (fixture.rule === "react/no-deprecated") {
      invalid = (await lintProduction(fixture.invalid)).filter(message => deprecationIds.has(message.ruleId));
      valid = (await lintProduction(fixture.valid)).filter(message => deprecationIds.has(message.ruleId));
    } else {
      const rules = { [fixture.rule]: fixture.options ? ["error", fixture.options] : "error" };
      invalid = lintNative(fixture.invalid, rules).messages;
      valid = lintNative(fixture.valid, rules).messages;
    }
    assert.ok(invalid.some(message => message.severity === 2), `${index}: ${fixture.rule} invalid`);
    assert.deepEqual(valid, [], `${index}: ${fixture.rule} valid`);
  }
});

test("all 11 frozen default-export cases retain the import warning contract", () => {
  for (const fixture of importScope.imports) {
    const messages = lintNative(fixture.code).messages.filter(message => message.ruleId === "import/no-anonymous-default-export");
    assert.equal(Boolean(messages.length), fixture.expected, fixture.name);
    assert.ok(messages.every(message => message.severity === 1));
  }
  const sideEffects = { "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }] };
  assert.deepEqual(lintNative("import './style.css';", sideEffects).messages, []);
  assert.ok(lintNative("import './setup.js';", sideEffects).messages.some(message => message.ruleId === "import/no-unassigned-import"));
});

test("JS/TSX JSX references, unused bindings and global namespaces retain baseline behavior", async () => {
  for (const fixture of importScope.scope) {
    const messages = [
      ...(await lintProduction(fixture.code, fixture.filename)).filter(message => message.ruleId === "@typescript-eslint/no-unused-vars"),
      ...lintNative(fixture.code).messages.filter(message => message.ruleId === "react/jsx-no-undef"),
    ];
    assert.equal(Boolean(messages.length), fixture.unused, `${fixture.filename}: ${fixture.name}`);
  }
});

test("accessibility Image, ARIA and optional custom-control globs still reject invalid controls", () => {
  checkPair("jsx-a11y/label-has-associated-control", [{ controlComponents: ["Custom*"], assert: "nesting" }], "const view=<label>Label<CustomInput/></label>;", "const view=<label>Label<OtherInput/></label>;");
  checkPair("jsx-a11y/alt-text", [{ elements: ["img"], img: ["Image"] }], "const view=<Image alt='description'/>;", "const view=<Image/>;");
  checkPair("jsx-a11y/aria-props", [], "const view=<div aria-label='label'/>;", "const view=<div aria-madeup='label'/>;");
  checkPair("jsx-a11y/aria-proptypes", [], "const view=<div aria-hidden='true'/>;", "const view=<div aria-hidden='maybe'/>;");
  checkPair("jsx-a11y/aria-unsupported-elements", [], "const view=<div aria-label='label'/>;", "const view=<meta aria-label='label'/>;");
  checkPair("jsx-a11y/role-has-required-aria-props", [], "const view=<div role='checkbox' aria-checked='false'/>;", "const view=<div role='checkbox'/>;");
  checkPair("jsx-a11y/role-supports-aria-props", [], "const view=<div role='checkbox' aria-checked='false'/>;", "const view=<div role='button' aria-checked='false'/>;");
});

test("Next, Hooks, TypeScript and standard import path restrictions keep their rule paths", () => {
  checkPair("@next/next/no-sync-scripts", [], "const view=<script async src='/app.js'/>;", "const view=<script src='/app.js'/>;");
  checkPair("react-hooks/rules-of-hooks", [], "function Example(){useState(0);return null;}", "function Example(){if(ready)useState(0);return null;}");
  checkPair("react-hooks/exhaustive-deps", [], "function Example({value}){useEffect(()=>{console.log(value);},[value]);return null;}", "function Example({value}){useEffect(()=>{console.log(value);},[]);return null;}");
  checkPair("@typescript-eslint/no-explicit-any", [], "const value:unknown=1;", "const value:any=1;");
  checkPair("no-restricted-imports", [{ patterns: ["pkg/private/**"] }], "import value from 'pkg/public/value.js';", "import value from 'pkg/private/value.js';");
});

test("native file pattern inclusion/exclusion and TypeScript-only core rules keep their scope", () => {
  const config = [{ files: ["**/*.js"], ignores: ["**/ignored.js"], rules: { "no-var": "error" } }];
  const lint = (code, filename) => new Linter().verify(code, config, { filename: `${root}/${filename}` });
  assert.ok(lint("var value=1;", "included.js").some(message => message.ruleId === "no-var"));
  assert.deepEqual(lint("const value=1;", "included.js"), []);
  assert.deepEqual(lint("var value=1;", "ignored.js"), []);
});

test("every remaining minimatch consumer resolves the patched named/class CJS and ESM API", async () => {
  const consumers = ["eslint", "@eslint/config-array", "@typescript-eslint/typescript-estree", "eslint-plugin-jsx-a11y-x"];
  for (const consumer of consumers) {
    const consumerRequire = createRequire(import.meta.resolve(consumer));
    const api = consumerRequire("minimatch");
    assert.equal(api.minimatch(".hidden.js", "*.js", { dot: true }), true, consumer);
    assert.equal(new api.Minimatch("**/*.tsx", { dot: true }).match("app/.hidden.tsx"), true, consumer);
    const esm = await import(consumerRequire.resolve("minimatch").replace("/commonjs/", "/esm/"));
    assert.equal(esm.minimatch("CustomInput", "Custom*"), true, consumer);
  }
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const versions = Object.entries(lock.packages).filter(([path]) => path.endsWith("/minimatch")).map(([,value]) => value.version);
  assert.ok(versions.length);
  assert.ok(versions.every(version => version === "11.0.1"));
  assert.equal(require("minimatch").makeRe, undefined); // import-x cannot be substituted: it imports this removed export.
});

test("the actual TypeScript parser default-project path retains type information", () => {
  assert.equal(probeProjectService(), true);
});

test("all prior active rule severities/options remain in an engine or a tested replacement", async () => {
  const eslint = new ESLint({ cwd: root });
  const markers = new Set(["react/jsx-uses-react", "react/jsx-uses-vars"]);
  const severity = value => Array.isArray(value) ? severity(value[0]) : ({ error: 2, warn: 1, off: 0 }[value] ?? value);
  for (const [filename, snapshot] of Object.entries(active)) {
    const config = await eslint.calculateConfigForFile(filename);
    for (const [rule, expected] of Object.entries(snapshot.enabledRules)) {
      if (markers.has(rule)) continue; // exercised by the frozen JS/TSX reference fixtures above
      if (rule === "react/no-deprecated") {
        assert.equal(severity(config.rules["no-restricted-properties"]), 2);
        assert.equal(severity(config.rules["no-restricted-syntax"]), 2);
      } else if (rule.startsWith("react/") || rule.startsWith("import/")) {
        assert.equal(severity(nativeConfig.rules[rule]), expected[0], rule);
      } else {
        assert.equal(severity(config.rules[rule]), expected[0], rule);
        for (const [index, option] of expected.slice(1).entries()) {
          assert.deepEqual(config.rules[rule][index + 1], option, rule);
        }
      }
    }
  }
  const result = lintNative("const view=<Missing/>;");
  assert.equal(result.exit, 1);
  assert.ok(result.messages.some(message => message.ruleId === "react/jsx-no-undef" && message.severity === 2));
});
