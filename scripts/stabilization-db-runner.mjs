#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const INVENTORIED_TABLES = [
  "matter_items", "reading_sessions", "matter_tags", "item_tags", "annotations",
  "daily_stats", "sync_runs", "sync_state", "app_sessions", "app_login_attempts",
];

export function catalogSql(tables = INVENTORIED_TABLES) {
  const inventory = tables.map((table) => `'${table}'`).join(", ");
  return String.raw`
DO $catalog$
DECLARE table_name text; privilege_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[${inventory}] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'missing inventoried table public.%', table_name;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(format('public.%I', table_name))) THEN
      RAISE EXCEPTION 'RLS is disabled on public.%', table_name;
    END IF;
    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('service_role', format('public.%I', table_name), privilege_name) THEN
        RAISE EXCEPTION 'service_role lacks % on public.%', privilege_name, table_name;
      END IF;
    END LOOP;
    IF has_table_privilege('anon', format('public.%I', table_name), 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'browser role retains CRUD privilege on public.%', table_name;
    END IF;
  END LOOP;
  IF to_regprocedure('public.set_updated_at()') IS NULL
     OR to_regprocedure('public.record_app_login_attempt(text,boolean,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'required function signature is missing';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.set_updated_at()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.record_app_login_attempt(text,boolean,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lacks required function EXECUTE';
  END IF;
  IF has_function_privilege('anon', 'public.set_updated_at()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.set_updated_at()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.record_app_login_attempt(text,boolean,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_app_login_attempt(text,boolean,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'browser role retains inherited or direct function EXECUTE';
  END IF;
END
$catalog$;
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
`;
}

export function runPsql({ databaseUrl, sql, psqlBinary = "psql", env = process.env }) {
  const result = spawnSync(psqlBinary, ["-XAtq", "-v", "ON_ERROR_STOP=1", "-d", databaseUrl, "-f", "-"], {
    input: sql,
    encoding: "utf8",
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`psql failed with exit ${result.status}: ${result.stderr.trim()}`);
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export async function repositoryMigrationVersions(migrationsDir) {
  const files = await readdir(migrationsDir);
  return files.filter((name) => /^\d+_.+\.sql$/.test(name)).sort().map((name) => name.slice(0, name.indexOf("_")));
}

export async function verifyCatalog({ databaseUrl, migrationsDir, psqlBinary, env }) {
  const expected = await repositoryMigrationVersions(migrationsDir);
  const actual = runPsql({ databaseUrl, sql: catalogSql(), psqlBinary, env });
  assert.deepEqual(actual, expected, `database migration history differs from repository chain\nactual: ${actual.join(", ")}\nexpected: ${expected.join(", ")}`);
  return actual;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.env.DISPOSABLE_DB_ACK !== "yes" || !process.env.STABILIZATION_TEST_DATABASE_URL) {
    throw new Error("Refusing to run: set DISPOSABLE_DB_ACK=yes and STABILIZATION_TEST_DATABASE_URL for a disposable database.");
  }
  const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
  const versions = await verifyCatalog({ databaseUrl: process.env.STABILIZATION_TEST_DATABASE_URL, migrationsDir });
  console.log(`Catalog and complete migration history verified (${versions.length} migrations).`);
}
