import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { probeProjectService } from "../../../scripts/lint-compatibility.mjs";

const require = createRequire(import.meta.url);
const consumers = ["eslint", "@eslint/config-array", "@typescript-eslint/typescript-estree", "eslint-plugin-jsx-a11y-x"];
const cases = [
  ["fixture.js", "*.js", true], ["fixture.ts", "*.js", false],
  [".hidden.js", "*.js", true], ["a/fixture.js", "*.js", false],
  ["a/fixture.js", "**/*.js", true], ["a/fixture.ts", "**/*.{js,ts}", true],
  ["a/fixture.css", "**/*.{js,ts}", false], ["fixture.js", "!*.ts", true],
  ["fixture.ts", "!*.ts", false], ["fixture.js", "#fixture.js", false],
];
for (const consumer of consumers) {
  const consumerRequire = createRequire(import.meta.resolve(consumer));
  const api = consumerRequire("minimatch");
  for (const [file, pattern, expected] of cases) assert.equal(api.minimatch(file, pattern, { dot: true }), expected, consumer);
  assert.equal(new api.Minimatch("**/*.tsx", { dot: true }).match("app/.hidden.tsx"), true, consumer);
  const esm = await import(consumerRequire.resolve("minimatch").replace("/commonjs/", "/esm/"));
  assert.equal(esm.minimatch("CustomInput", "Custom*"), true, consumer);
}
assert.equal(require("minimatch").makeRe, undefined);
assert.equal(probeProjectService(), true);
console.log("PASS: all four consumers' CJS/ESM named/class APIs, ten glob controls each, actual parser projectService/type-information path.");
