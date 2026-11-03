import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ESLint, Linter } from "eslint";
import { parseForESLint } from "@typescript-eslint/parser";
import config from "../eslint.config.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const nativeConfig = JSON.parse(readFileSync(join(root, "oxlint.config.json"), "utf8"));
const eslint = new ESLint({ cwd: root });
const common = config.find(item => item.plugins);

export async function lintProduction(code, filename = "compatibility-fixture.jsx") {
  return (await eslint.lintText(code, { filePath: join(root, filename) }))[0].messages;
}

export function lintRules(code, rules, filename = "compatibility-fixture.tsx") {
  return new Linter().verify(code, [{
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: common.languageOptions,
    plugins: common.plugins,
    rules,
  }], { filename: join(root, filename) });
}

export function lintNative(code, rules = nativeConfig.rules) {
  const directory = mkdtempSync(join(tmpdir(), "matter-lint-"));
  try {
    const filename = join(directory, "fixture.jsx");
    const configPath = join(directory, "config.json");
    writeFileSync(filename, code);
    writeFileSync(configPath, JSON.stringify({ ...nativeConfig, rules }));
    const result = spawnSync(process.execPath, [join(root, "node_modules/oxlint/bin/oxlint"), "-c", configPath, "--format", "json", filename], { cwd: root, encoding: "utf8", timeout: 15_000 });
    if (result.error || ![0, 1].includes(result.status)) throw new Error(`Native lint failed: ${result.error?.message ?? result.stderr}`);
    const report = JSON.parse(result.stdout);
    return {
      exit: result.status,
      messages: report.diagnostics.map(item => {
        const match = item.code?.match(/^([^()]+)\(([^()]+)\)$/);
        return { ruleId: match ? `${match[1]}/${match[2]}` : item.code, severity: item.severity === "error" ? 2 : 1, message: item.message };
      }),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function probeProjectService() {
  const directory = mkdtempSync(join(tmpdir(), "matter-parser-"));
  try {
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: { allowJs: true, checkJs: true }, files: ["placeholder.ts"] }));
    writeFileSync(join(directory, "placeholder.ts"), "export {};\n");
    const filePath = join(directory, "fixture.js");
    writeFileSync(filePath, "const value = 1;\n");
    const result = parseForESLint("const value = 1;", { filePath, tsconfigRootDir: directory, projectService: { allowDefaultProject: ["*.js"], defaultProject: "tsconfig.json" } });
    return Boolean(result.services.program?.getSourceFile(filePath));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
