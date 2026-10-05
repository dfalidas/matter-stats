import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { catalogSql, INVENTORIED_TABLES, verifyCatalog } from "../scripts/stabilization-db-runner.mjs";

test("catalog inventory includes independent sync streams", () => {
  assert.ok(INVENTORIED_TABLES.includes("matter_sync_streams"));
  assert.match(catalogSql(), /'matter_sync_streams'/);
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "db-runner-"));
  const migrationsDir = path.join(root, "migrations");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(migrationsDir));
  await writeFile(path.join(migrationsDir, "20260101000000_one.sql"), "select 1;");
  await writeFile(path.join(migrationsDir, "20260102000000_two.sql"), "select 2;");
  const argsFile = path.join(root, "args");
  const sqlFile = path.join(root, "sql");
  const psql = path.join(root, "psql");
  await writeFile(psql, `#!/bin/sh\nprintf '%s\\n' "$@" > "$ARGS_FILE"\ncat > "$SQL_FILE"\n[ "$FAIL_SQL" = yes ] && { echo 'catalog failure' >&2; exit 3; }\nif [ -n "$MISSING_PRIVILEGE" ]; then\n  grep -q "ARRAY\\['SELECT', 'INSERT', 'UPDATE', 'DELETE'\\]" "$SQL_FILE" || exit 9\n  echo "service_role lacks $MISSING_PRIVILEGE" >&2\n  exit 3\nfi\n[ "$EMIT_COMMAND_TAG" = yes ] && echo DO\nprintf '%s\\n' "$HISTORY"\n`);
  await chmod(psql, 0o755);
  return { root, migrationsDir, psql, argsFile, sqlFile, env: { ...process.env, ARGS_FILE: argsFile, SQL_FILE: sqlFile } };
}

test("actual psql invocation quietly accepts only the complete migration chain", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const actual = await verifyCatalog({ databaseUrl: "postgres://disposable", migrationsDir: f.migrationsDir, psqlBinary: f.psql, env: { ...f.env, HISTORY: "20260101000000\n20260102000000" } });
  assert.deepEqual(actual, ["20260101000000", "20260102000000"]);
  const args = (await readFile(f.argsFile, "utf8")).split("\n");
  assert.ok(args.includes("-XAtq"), "psql disables startup files, uses unaligned tuples-only output, and is quiet");
  assert.ok(args.includes("ON_ERROR_STOP=1"));
  assert.match(await readFile(f.sqlFile, "utf8"), /SELECT version FROM supabase_migrations\.schema_migrations/);
});

test("actual output parsing rejects missing, extra, unexpected, and command-tag lines", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const history of ["20260101000000", "20260101000000\n20260102000000\n20260103000000", "20260101000000\nwrong"]) {
    await assert.rejects(verifyCatalog({ databaseUrl: "postgres://disposable", migrationsDir: f.migrationsDir, psqlBinary: f.psql, env: { ...f.env, HISTORY: history } }), /migration history differs/);
  }
  await assert.rejects(verifyCatalog({ databaseUrl: "postgres://disposable", migrationsDir: f.migrationsDir, psqlBinary: f.psql, env: { ...f.env, HISTORY: "20260101000000\n20260102000000", EMIT_COMMAND_TAG: "yes" } }), /migration history differs/);
});

test("actual psql execution failures remain failures", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(verifyCatalog({ databaseUrl: "postgres://disposable", migrationsDir: f.migrationsDir, psqlBinary: f.psql, env: { ...f.env, FAIL_SQL: "yes" } }), /psql failed with exit 3: catalog failure/);
});

test("actual verification path fails for each absent service_role CRUD privilege", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    await assert.rejects(verifyCatalog({
      databaseUrl: "postgres://disposable",
      migrationsDir: f.migrationsDir,
      psqlBinary: f.psql,
      env: { ...f.env, MISSING_PRIVILEGE: privilege },
    }), new RegExp(`service_role lacks ${privilege}`));
  }
});

test("catalog SQL requires every service_role CRUD privilege individually", () => {
  const sql = catalogSql(["sample"]);
  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert.match(sql, new RegExp(`ARRAY\\['SELECT', 'INSERT', 'UPDATE', 'DELETE'\\]`));
    assert.match(sql, /has_table_privilege\('service_role'.*privilege_name\)/);
    assert.match(sql, new RegExp(`lacks % on public\\.%`));
    assert.ok(sql.includes(privilege));
  }
  assert.match(sql, /has_table_privilege\('anon'.*'SELECT,INSERT,UPDATE,DELETE'\)/);
});

test("catalog SQL rejects effective browser table and column privileges for both roles", () => {
  const sql = catalogSql(["sample"]);
  assert.match(sql, /ARRAY\['anon', 'authenticated'\]/);
  assert.match(sql, /ARRAY\['SELECT', 'INSERT', 'UPDATE'\]/);
  assert.match(sql, /has_any_column_privilege\(browser_role,.*privilege_name\)/);
  assert.match(sql, /has_table_privilege\('anon'.*'SELECT,INSERT,UPDATE,DELETE'\)/);
  assert.match(sql, /has_table_privilege\('authenticated'.*'SELECT,INSERT,UPDATE,DELETE'\)/);
});
