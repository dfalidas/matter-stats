// Replay the frozen cases against an independently installed legacy checkout.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

if (!process.argv[2]) throw new Error("Pass the legacy baseline checkout path");
const baseline = resolve(process.argv[2]);
const legacyRequire = createRequire(resolve(baseline, "package.json"));
const { ESLint, Linter } = legacyRequire("eslint");
const parser = legacyRequire("@typescript-eslint/parser");
const react = legacyRequire("eslint-plugin-react");
const imports = legacyRequire("eslint-plugin-import");
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const reactCases = read("react-rule-oracle.json").cases;
const importScope = read("import-scope-oracle.json");
let controls = 0;
for (const fixture of reactCases) {
  const rules = { [fixture.rule]: fixture.options ? ["error", fixture.options] : "error" };
  const config = [{ languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } }, settings: { react: { version: "19.2.6" } }, plugins: { react }, rules }];
  assert.ok(new Linter().verify(fixture.invalid, config).some(message => message.ruleId === fixture.rule));
  assert.deepEqual(new Linter().verify(fixture.valid, config), []);
  controls += 2;
}
for (const fixture of importScope.imports) {
  const messages = new Linter().verify(fixture.code, [{ languageOptions: { parser }, plugins: { import: imports }, rules: { "import/no-anonymous-default-export": "warn" } }]);
  assert.equal(Boolean(messages.length), fixture.expected);
  controls++;
}
const eslint = new ESLint({ cwd: baseline });
for (const fixture of importScope.scope) {
  const messages = (await eslint.lintText(fixture.code, { filePath: resolve(baseline, fixture.filename) }))[0].messages.filter(message => ["@typescript-eslint/no-unused-vars", "react/jsx-no-undef"].includes(message.ruleId));
  assert.equal(Boolean(messages.length), fixture.unused);
  controls++;
}
console.log(JSON.stringify({ testedSha: execFileSync("git", ["-C", baseline, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), reactPairs: reactCases.length, importCases: importScope.imports.length, scopeCases: importScope.scope.length, controls, result: "passed" }, null, 2));
