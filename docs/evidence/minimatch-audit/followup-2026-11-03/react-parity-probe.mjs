// Run from the repository after installing the separately documented probe packages.
// These candidate packages are never part of the application's dependency graph.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(process.argv[2] || ".");
const probeRoot = resolve(process.argv[3] || "work/lint-probe");
const oldRequire = createRequire(resolve(repoRoot, "package.json"));
const probeRequire = createRequire(resolve(probeRoot, "package.json"));
const { Linter: LegacyLinter } = oldRequire("eslint");
const { Linter } = probeRequire("eslint");
const legacyReact = oldRequire("eslint-plugin-react");
const { default: modern } = await import(pathToFileURL(resolve(probeRoot, "node_modules/@eslint-react/eslint-plugin/dist/index.js")));
const fixtures = {
  createClass: "import React from 'react'; React.createClass({render(){return <div/>;}});",
  propTypes: "import React from 'react'; const x = React.PropTypes;",
  lifecycle: "import React from 'react'; class Example extends React.Component {componentWillMount(){} render(){return <div/>;}}",
  valid: "import React from 'react'; export function Example(){return <div/>;}",
};
const results = {};
for (const [name, code] of Object.entries(fixtures)) {
  const languageOptions = { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } };
  const legacy = new LegacyLinter().verify(code, [{ languageOptions, settings: { react: { version: "19.2.6" } }, plugins: { react: legacyReact }, rules: { "react/no-deprecated": "error" } }]);
  const candidate = new Linter().verify(code, [{ ...modern.configs.recommended, languageOptions }]);
  const messages = list => list.map(message => ({ rule: message.ruleId, message: message.message }));
  results[name] = { legacy: messages(legacy), modern: messages(candidate) };
}
console.log(JSON.stringify(results, null, 2));
