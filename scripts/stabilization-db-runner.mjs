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

export const INVENTORIED_FUNCTIONS = [
  'set_updated_at()', 'record_app_login_attempt(text,boolean,integer,integer)',
  ...LEASE_FUNCTION_SIGNATURES, ...PAGE_FUNCTION_SIGNATURES, ...CONTINUATION_FUNCTION_SIGNATURES,
  ...REQUEST_FUNCTION_SIGNATURES, ...GENERATION_FUNCTION_SIGNATURES, ...STATUS_FUNCTION_SIGNATURES,
];
// There are currently no application views. A new view must acquire an explicit
// security contract and tests before this closed inventory can be expanded.
export const INVENTORIED_VIEWS = [];

export function catalogSql(tables = INVENTORIED_TABLES) {
  const inventory = tables.map((table) => `'${table}'`).join(", ");
  return String.raw`
DO $catalog$
DECLARE unexpected text; table_name text; privilege_name text; browser_role text; function_signature text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO unexpected
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
      AND NOT (c.relkind IN ('r','p') AND c.relname=ANY(ARRAY[${inventory}]));
  IF unexpected IS NOT NULL THEN RAISE EXCEPTION 'uncovered app relation/view: %', unexpected; END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO unexpected
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
      AND NOT (p.oid=ANY(ARRAY[${INVENTORIED_FUNCTIONS.map(s => `to_regprocedure('public.${s}')`).join(', ')}]::oid[]));
  IF unexpected IS NOT NULL THEN RAISE EXCEPTION 'uncovered app function: %', unexpected; END IF;
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
    IF has_table_privilege('anon', format('public.%I', table_name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'browser role retains CRUD privilege on public.%', table_name;
    END IF;
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
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
  FOREACH function_signature IN ARRAY ARRAY[${INVENTORIED_FUNCTIONS.map((signature) => `'public.${signature}'`).join(", ")}] LOOP
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
    IF function_signature = 'public.record_app_login_attempt(text,boolean,integer,integer)' THEN
      IF (SELECT NOT prosecdef OR proowner <> 'postgres'::regrole OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] FROM pg_proc WHERE oid=to_regprocedure(function_signature)) THEN
        RAISE EXCEPTION 'invalid limiter definer/owner/search_path';
      END IF;
    ELSIF function_signature = 'public.set_updated_at()' THEN
      IF (SELECT prosecdef OR proconfig IS NOT NULL FROM pg_proc WHERE oid=to_regprocedure(function_signature)) THEN
        RAISE EXCEPTION 'invalid legacy trigger security properties';
      END IF;
    ELSIF (SELECT prosecdef OR NOT coalesce('search_path=""' = ANY(proconfig), false) FROM pg_proc WHERE oid = to_regprocedure(function_signature)) THEN
      RAISE EXCEPTION 'lease function must be invoker with empty search_path: %', function_signature;
    END IF;
  END LOOP;

END
$catalog$;
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
`;
}

// Negative controls execute the SAME catalog assertion, in a rollback-only
// transaction. No missing RPC, transport error or unrelated SQL failure counts.
export function catalogCoverageProbesSql() {
  const assertion = catalogSql().split('SELECT version FROM')[0];
  const probes = [
    ["create table public.disposable_uncovered_table(id integer)", "uncovered app relation/view: disposable_uncovered_table"],
    ["create view public.disposable_uncovered_view as select 1 as id", "uncovered app relation/view: disposable_uncovered_view"],
    ["create function public.repair_words(text) returns text language sql as 'select $1'", "uncovered app function: repair_words(text)"],
  ];
  return probes.map(([create, expected]) => `begin;
    ${create};
    do $probe$ begin
      begin
        execute $assertion$${assertion}$assertion$;
        raise exception 'catalog accepted uncovered object';
      exception when raise_exception then
        if sqlerrm <> '${expected}' then raise; end if;
      end;
    end $probe$;
    rollback;`).join('\n');
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
