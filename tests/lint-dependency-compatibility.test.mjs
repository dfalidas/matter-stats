import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { Linter } from "eslint";
import { FlatCompat } from "@eslint/eslintrc";

const require = createRequire(import.meta.url);
const react = require("eslint-plugin-react");
const imports = require("eslint-plugin-import");
const a11y = require("eslint-plugin-jsx-a11y");
const hooks = require("eslint-plugin-react-hooks");
const next = require("@next/eslint-plugin-next");
const typescript = require("@typescript-eslint/eslint-plugin");
const parser = require("@typescript-eslint/parser");

function verify(code, rules, filename = "fixture.jsx") {
  return new Linter().verify(code, [{
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "19.2.6" } },
    plugins: { react, import: imports, "jsx-a11y": a11y, "react-hooks": hooks, "@next/next": next, "@typescript-eslint": typescript },
    rules,
  }], { filename });
}

function checkPair(rule, options, valid, invalid, filename) {
  const rules = { [rule]: ["error", ...options] };
  assert.deepEqual(verify(valid, rules, filename), [], `${rule}: valid control`);
  const messages = verify(invalid, rules, filename);
  assert.ok(messages.some(message => message.ruleId === rule), `${rule}: invalid case must report the target rule, not a parser failure`);
  assert.ok(messages.every(message => !message.fatal), `${rule}: no fatal parser errors`);
}

test("React optional PascalCase glob ignores call the legacy minimatch function", () => {
  checkPair("react/jsx-pascal-case", [{ ignore: ["Allowed_*"] }],
    "const view = <Allowed_component/>;", "const view = <Denied_component/>;");
});

test("React nested render props exercise render* glob matching", () => {
  checkPair("react/no-unstable-nested-components", [],
    "function Example(){return <Wrapper renderFooter={() => <div/>}/>;}",
    "function Example(){return <Wrapper footer={() => <div/>}/>;}");
});

test("import internal-module glob restrictions exercise legacy makeRe", () => {
  checkPair("import/no-internal-modules", [{ forbid: ["pkg/private/**"] }],
    "import value from 'pkg/public/value.js';", "import value from 'pkg/private/value.js';");
});

test("import side-effect allow globs exercise callable minimatch", () => {
  checkPair("import/no-unassigned-import", [{ allow: ["**/*.css"] }],
    "import './style.css';", "import './setup.js';");
});

test("accessibility custom-control globs retain label validation", () => {
  checkPair("jsx-a11y/label-has-associated-control", [{ controlComponents: ["Custom*"], assert: "nesting" }],
    "const view = <label>Label<CustomInput/></label>;", "const view = <label>Label<OtherInput/></label>;");
});

test("FlatCompat override and flat file matching retain path selection", () => {
  const compat = new FlatCompat();
  const config = compat.config({ overrides: [{ files: ["**/*.js"], excludedFiles: ["**/ignored.js"], rules: { "no-var": "error" } }] });
  const lint = (code, filename) => new Linter().verify(code, config, { filename: resolve(filename) });
  assert.ok(lint("var value = 1;", "included.js").some(message => message.ruleId === "no-var"));
  assert.deepEqual(lint("const value = 1;", "included.js"), []);
  assert.deepEqual(lint("var value = 1;", "ignored.js"), []);
});

test("active Next, React, Hooks, TypeScript, import and accessibility families reject invalid controls", () => {
  checkPair("@next/next/no-sync-scripts", [], "const view = <script async src='/app.js'/>;", "const view = <script src='/app.js'/>;");
  checkPair("react/no-danger-with-children", [], "const view = <div dangerouslySetInnerHTML={{__html: 'x'}}/>;", "const view = <div dangerouslySetInnerHTML={{__html: 'x'}}>text</div>;");
  checkPair("react-hooks/rules-of-hooks", [], "function Example(){useState(0);return null;}", "function Example(){if(ready)useState(0);return null;}");
  checkPair("@typescript-eslint/no-explicit-any", [], "const value: unknown = 1;", "const value: any = 1;", "fixture.ts");
  checkPair("import/no-anonymous-default-export", [], "const value = {}; export default value;", "export default {};");
  checkPair("jsx-a11y/alt-text", [{ elements: ["img"], img: ["Image"] }], "const view = <Image alt='description'/>;", "const view = <Image/>;");
});

test("React legacy deprecation checks survive even when the current application never calls these APIs", () => {
  const valid = "import React from 'react'; export function Example(){return <div/>;}";
  for (const invalid of [
    "import React from 'react'; React.createClass({render(){return <div/>;}});",
    "import React from 'react'; const value = React.PropTypes;",
    "import React from 'react'; class Example extends React.Component {componentWillMount(){} render(){return <div/>;}}",
  ]) checkPair("react/no-deprecated", [], valid, invalid);
});

test("the patched estree minimatch exposes the named API but cannot replace legacy callable/makeRe consumers", () => {
  const legacy = require("minimatch");
  const estreeRequire = createRequire(require.resolve("@typescript-eslint/typescript-estree"));
  const patched = estreeRequire("minimatch");
  assert.equal(legacy("CustomInput", "Custom*"), true);
  assert.equal(legacy.makeRe("pkg/private/**").test("pkg/private/value.js"), true);
  assert.equal(patched.minimatch(".hidden.js", "*.js", { dot: true }), true);
  assert.throws(() => patched("CustomInput", "Custom*"), TypeError);
  assert.equal(patched.makeRe, undefined);
});
