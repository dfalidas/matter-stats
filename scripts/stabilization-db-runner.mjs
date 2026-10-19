#!/usr/bin/env node
import { STATUS_TABLES, STATUS_FUNCTION_SIGNATURES } from "./matter-status-inventory.mjs";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { LEASE_FUNCTION_SIGNATURES } from "./matter-sync-lease-inventory.mjs";

import { PAGE_TABLES, PAGE_FUNCTION_SIGNATURES } from "./matter-page-inventory.mjs";

import { CONTINUATION_TABLES, CONTINUATION_FUNCTION_SIGNATURES } from "./matter-continuation-inventory.mjs";

import { REQUEST_TABLES, REQUEST_FUNCTION_SIGNATURES } from "./matter-request-inventory.mjs";

import { GENERATION_TABLES, GENERATION_FUNCTION_SIGNATURES } from "./reading-generation-inventory.mjs";

export const INVENTORIED_TABLES = [
  "matter_items", "reading_sessions", "matter_tags", "item_tags", "annotations",
  "daily_stats", "sync_runs", "sync_state", "app_sessions", "app_login_attempts",
  "matter_sync_streams", "matter_sync_leases", ...PAGE_TABLES, ...CONTINUATION_TABLES, ...REQUEST_TABLES, ...GENERATION_TABLES, ...STATUS_TABLES,
];

export function catalogSql(tables = INVENTORIED_TABLES) {
  const inventory = tables.map((table) => `'${table}'`).join(", ");
  return String.raw`
DO $catalog$
DECLARE table_name text; privilege_name text; browser_role text; function_signature text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[${inventory}] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'missing inventoried table public.%', table_name;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(format('public.%I', table_name))) THEN
      RAISE EXCEPTION 'RLS is disabled on public.%', table_name;
    END IF;
    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF (table_name='reading_generation_control' AND privilege_name IN ('INSERT','DELETE')) OR (table_name='reading_repair_source' AND privilege_name IN ('UPDATE','DELETE')) THEN
        IF has_table_privilege('service_role', format('public.%I', table_name), privilege_name) THEN RAISE EXCEPTION 'unexpected generation privilege'; END IF;
        CONTINUE;
      END IF;
      IF table_name IN ('matter_sync_leases','matter_sync_continuation','matter_quota','matter_request_work') AND privilege_name IN ('INSERT', 'DELETE') THEN
        IF has_table_privilege('service_role', format('public.%I', table_name), privilege_name) THEN
          RAISE EXCEPTION 'service_role can reset durable lease/intent public.% via %', table_name, privilege_name;
        END IF;
        CONTINUE;
      END IF;
      IF NOT has_table_privilege('service_role', format('public.%I', table_name), privilege_name) THEN
        RAISE EXCEPTION 'service_role lacks % on public.%', privilege_name, table_name;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_class c,
        LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid = to_regclass(format('public.%I', table_name)) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'PUBLIC retains table privilege on public.%', table_name;
    END IF;
    IF has_table_privilege('anon', format('public.%I', table_name), 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'browser role retains CRUD privilege on public.%', table_name;
    END IF;
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
        IF has_any_column_privilege(browser_role, format('public.%I', table_name), privilege_name) THEN
          RAISE EXCEPTION '% retains column-level % privilege on public.%', browser_role, privilege_name, table_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF has_table_privilege('service_role', 'public.matter_sync_leases', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role can truncate durable lease';
  END IF;
  IF has_table_privilege('service_role','public.matter_sync_continuation','TRUNCATE') THEN RAISE EXCEPTION 'continuation can be truncated'; END IF;
  IF has_table_privilege('service_role','public.matter_quota','TRUNCATE') OR has_table_privilege('service_role','public.matter_request_work','TRUNCATE') THEN RAISE EXCEPTION 'request state can be truncated'; END IF;
  FOREACH function_signature IN ARRAY ARRAY[${[...LEASE_FUNCTION_SIGNATURES, ...PAGE_FUNCTION_SIGNATURES, ...CONTINUATION_FUNCTION_SIGNATURES, ...REQUEST_FUNCTION_SIGNATURES, ...GENERATION_FUNCTION_SIGNATURES, ...STATUS_FUNCTION_SIGNATURES].map((signature) => `'public.${signature}'`).join(", ")}] LOOP
    IF to_regprocedure(function_signature) IS NULL THEN
      RAISE EXCEPTION 'missing lease function %', function_signature;
    END IF;
    IF NOT has_function_privilege('service_role', function_signature, 'EXECUTE')
       OR has_function_privilege('anon', function_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'invalid execution grants for %', function_signature;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p,
        LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = to_regprocedure(function_signature) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'PUBLIC retains EXECUTE on %', function_signature;
    END IF;
    IF (SELECT prosecdef OR NOT coalesce('search_path=""' = ANY(proconfig), false) FROM pg_proc WHERE oid = to_regprocedure(function_signature)) THEN
      RAISE EXCEPTION 'lease function must be invoker with empty search_path: %', function_signature;
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

export async function verifyCatalog({ databaseUrl, migrationsDir, psqlBinary, env, execute }) {
  const expected = await repositoryMigrationVersions(migrationsDir);
  const actual = execute ? execute(catalogSql()) : runPsql({ databaseUrl, sql: catalogSql(), psqlBinary, env });
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
