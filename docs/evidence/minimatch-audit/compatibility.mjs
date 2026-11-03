import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const root = createRequire(join(resolve(process.argv[2] || '.'), 'package.json'));
const estreePath = root.resolve('@typescript-eslint/typescript-estree');
const estreeRequire = createRequire(estreePath);
const modern = estreeRequire('minimatch');
const legacy = root('minimatch');
assert.equal(typeof legacy, 'function');
assert.equal(typeof modern, 'object');
assert.equal(typeof modern.minimatch, 'function');
assert.equal(modern.makeRe, undefined);
const cases = [
 ['fixture.js', '*.js', true], ['fixture.ts', '*.js', false],
 ['.hidden.js', '*.js', true], ['a/fixture.js', '*.js', false],
 ['a/fixture.js', '**/*.js', true], ['a/fixture.ts', '**/*.{js,ts}', true],
 ['a/fixture.css', '**/*.{js,ts}', false], ['fixture.js', '!*.ts', true],
 ['fixture.ts', '!*.ts', false], ['fixture.js', '#fixture.js', false],
];
for (const [file, pattern, expected] of cases) {
 assert.equal(modern.minimatch(file, pattern, {dot:true}), expected);
 assert.equal(legacy(file, pattern, {dot:true}), expected);
}
(async () => {
 const esm = await import(estreeRequire.resolve('minimatch').replace('/commonjs/', '/esm/'));
 assert.equal(esm.minimatch('.hidden.js', '*.js', {dot:true}), true);
 const dir = mkdtempSync(join(tmpdir(), 'minimatch-parser-'));
 try {
 writeFileSync(dir+'/tsconfig.json', JSON.stringify({compilerOptions:{allowJs:true,checkJs:true},files:['placeholder.ts']}));
 writeFileSync(dir+'/placeholder.ts', 'export {};\n');
 writeFileSync(dir+'/fixture.js', 'const value = 1;\n');
 const parser = root('@typescript-eslint/parser');
 const result = parser.parseForESLint('const value = 1;', {
  filePath:dir+'/fixture.js', tsconfigRootDir:dir,
  projectService:{allowDefaultProject:['*.js'], defaultProject:'tsconfig.json'},
 });
 assert.ok(result.services.program);
 assert.ok(result.services.program.getSourceFile(dir+'/fixture.js'));
 } finally { rmSync(dir, {recursive:true, force:true}); }
 console.log('PASS: legacy callable API preserved; patched CJS/ESM named API; 10 matching cases; actual parser project-service allowDefaultProject with type information.');
})().catch(error => {console.error(error);process.exitCode=1;});
