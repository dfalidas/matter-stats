import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import postcss from "postcss";
import nested from "postcss-nested";
import tailwind from "tailwindcss";
import plugin from "tailwindcss/plugin.js";
import { SourceMapConsumer, SourceNode } from "source-map-js";

// Captured with the same parents and parser 6.1.4 before the security update.
// Check complete selector/declaration output across their real AST mutations.
const before = JSON.parse(await readFile(new URL("./fixtures/css-parent-compatibility.json", import.meta.url), "utf8"));
const require = createRequire(import.meta.url);
const config = {
  content: [{ raw: "", extension: "html" }],
  safelist: ["group-hover:block", "peer-checked:bg-blue-500", "hover:bg-red-500", "[&:nth-child(2)]:text-blue-500", "before:content-['→']"],
  corePlugins: { preflight: false },
  plugins: [plugin(({ addVariant }) => addVariant("hocus", ["&:hover", "&:focus"]))],
};

function rules(result) {
  const output = [];
  result.root.walkRules((rule) => output.push({
    selector: rule.selector,
    declarations: rule.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value, node.important || false]),
  }));
  return output;
}

test("postcss-nested preserves ampersands, selector lists, pseudo nesting and media transforms with parser 7", async () => {
  const parent = createRequire(require.resolve("postcss-nested"));
  assert.equal(parent("postcss-selector-parser/package.json").version, "7.1.6", "parent must actually use the patched parser");
  const css = ".one, .two { &.active { color: red } &:hover > .child { color: blue } :is(&, .other) { margin: 0 } @media (min-width: 10px) { & + & { display: flex } } }";
  const result = await postcss([nested()]).process(css, { from: undefined });
  assert.deepEqual(rules(result), before.nested);
  assert.deepEqual(result.warnings(), []);
});

test("Tailwind preserves apply, group/peer, arbitrary and escaped Unicode selectors with parser 7", async () => {
  const parent = createRequire(require.resolve("tailwindcss"));
  assert.equal(parent("postcss-selector-parser/package.json").version, "7.1.6", "parent must actually use the patched parser");
  const css = "@tailwind utilities; .btn, .link { @apply font-bold hover:underline; } .nested { &:focus { @apply text-red-500; } }";
  const result = await postcss([tailwind(config), nested()]).process(css, { from: undefined });
  assert.deepEqual(rules(result), before.tailwind);
  assert.deepEqual(result.warnings(), []);
});

test("Tailwind prefix/important scoping and multi-selector variants retain their CSS", async () => {
  const result = await postcss([tailwind({
    ...config, prefix: "tw-", important: ".shell",
    safelist: ["tw-font-bold", "hocus:tw-block", "tw-w-[calc(100%-1rem)]", "hover:tw-text-blue-500"],
  })]).process("@tailwind utilities;", { from: undefined });
  assert.deepEqual(rules(result), before.prefix);
  assert.deepEqual(result.warnings(), []);
});

test("PostCSS maps and valid indexed SourceNode roundtrips work with source-map-js 1.2.2", async () => {
  const parent = createRequire(require.resolve("postcss"));
  assert.equal(parent("source-map-js/package.json").version, "1.2.2", "PostCSS must actually use the patched source map implementation");
  const css = ".card { color: red }\n.note { color: blue }";
  const result = await postcss([nested()]).process(css, {
    from: "input.css", to: "output.css", map: { inline: false, annotation: false },
  });
  const map = result.map.toJSON();
  const flat = new SourceMapConsumer(map);
  assert.equal(flat.sourceContentFor("input.css"), css);
  assert.deepEqual(flat.originalPositionFor({ line: 2, column: 0 }), { source: "input.css", line: 2, column: 0, name: null });
  const consumer = new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 0, column: 0 }, map }] });
  const flatMappings = [], indexedMappings = [];
  flat.eachMapping((mapping) => flatMappings.push(mapping));
  consumer.eachMapping((mapping) => indexedMappings.push(mapping));
  assert.deepEqual(indexedMappings, flatMappings);
  const roundtrip = SourceNode.fromStringWithSourceMap(result.css, consumer).toStringWithSourceMap({ file: "output.css" });
  assert.equal(roundtrip.code, css);
  assert.deepEqual(new SourceMapConsumer(roundtrip.map.toJSON()).originalPositionFor({ line: 2, column: 0 }), { source: "input.css", line: 2, column: 0, name: null });
});
