import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase-types";

type Row = Record<string, unknown>;
type Request = { table: string; url: URL; rows: Row[]; number: number };
type Options = {
  cap?: number;
  maxUrlBytes?: number;
  before?: (request: Request) => void;
  respond?: (request: Request, result: Row[]) => Response | undefined;
};

/** Real Supabase query builder + synthetic HTTP Data API, never a network call.
 * Evaluates serialized SQL-style filters/order before enforcing a response cap.
 * Expectations in service tests come from original fixture IDs/values, not this
 * query evaluator or the production pagination helper.
 */
export function cappedPostgrest(tables: Record<string, Row[]>, options: Options = {}) {
  const requests: Array<{ table: string; url: URL; ids: unknown[]; rowCount: number; responseBytes: number }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (options.maxUrlBytes) assert.ok(url.href.length <= options.maxUrlBytes, `encoded request exceeds ${options.maxUrlBytes} bytes`);
    const table = url.pathname.split("/").at(-1)!;
    if (table === "read_generation_estimates" && url.pathname.includes("/rpc/")) {
      const body = JSON.parse(String(init?.body)) as { p_generation: string | null; p_ids: string[] };
      assert.equal(body.p_generation, null, "legacy fixture is explicit; generation SQL is tested in isolated databases");
      const result = (tables.reading_sessions ?? []).filter(row => body.p_ids.includes(String(row.id)))
        .map(row => ({ id: row.id, words_estimated: row.words_estimated ?? null, word_estimation_method: row.word_estimation_method ?? null }));
      requests.push({ table, url, ids: result.map(row => row.id), rowCount: result.length, responseBytes: Buffer.byteLength(JSON.stringify(result)) });
      return Response.json(result);
    }
    const rows = tables[table] ?? (table === "reading_generation_control" ? [{ active: null }] : []);
    const request = { table, url, rows, number: requests.filter((r) => r.table === table).length + 1 };
    options.before?.(request);
    let result = [...rows];
    const selection = url.searchParams.get("select") ?? "*";
    // Model the existing FK semi-join: filter parents once, never multiply them
    // by the number of matching relation rows. This happens before count/range.
    if (table === "matter_items" && selection.includes("item_tags!inner(")) {
      const tagFilter = url.searchParams.get("item_tags.tag_id");
      assert.ok(tagFilter);
      const matches = (tables.item_tags ?? []).filter(predicate(`tag_id.${tagFilter}`));
      const itemIds = new Set(matches.map((row) => row.item_id));
      result = result.filter((row) => itemIds.has(row.id));
    }
    for (const [column, filter] of url.searchParams) {
      if (column === "item_tags.tag_id") continue;
      if (column === "or" || column === "and") result = result.filter(logical(`${column}${filter}`));
      else if (!["select", "order", "limit", "offset"].includes(column)) result = result.filter(predicate(`${column}.${filter}`));
    }
    const order = url.searchParams.get("order")?.split(",") ?? [];
    result.sort((a, b) => {
      for (const term of order) {
        const [column, direction, nulls] = term.split(".");
        const left = a[column], right = b[column];
        if (left == null || right == null) {
          if (left == null && right == null) continue;
          return (left == null ? -1 : 1) * (nulls === "nullsfirst" ? 1 : -1);
        }
        const comparison = compare(column, left, right);
        if (comparison) return direction === "desc" ? -comparison : comparison;
      }
      return 0;
    });
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? Infinity), options.cap ?? 1000);
    const total = result.length;
    result = result.slice(offset, offset + limit);
    const record = { table, url, ids: result.map((r) => r.id), rowCount: result.length, responseBytes: 0 };
    requests.push(record);
    const finish = async (response: Response) => {
      record.responseBytes = Buffer.byteLength(await response.clone().text());
      return response;
    };
    const injected = options.respond?.(request, result);
    if (injected) return finish(injected);
    // Materialize declared to-one FK embeds unless the test explicitly supplies
    // an object/array/null relationship shape. Project fields just like the API.
    result = result.map((row) => {
      if (selection === "*") return row;
      const projected: Row = {};
      for (const field of splitTerms(selection)) {
        const embed = /^(\w+)(?:!inner)?\((.*)\)$/.exec(field);
        if (!embed) { projected[field] = row[field] ?? null; continue; }
        const [, relation, fields] = embed;
        const joined = relation in row ? row[relation]
          : relation === "matter_items" ? (tables.matter_items ?? []).find((item) => item.id === row.item_id) ?? null
          : relation === "matter_tags" ? (tables.matter_tags ?? []).find((tag) => tag.id === row.tag_id) ?? null
          : relation === "item_tags" ? (tables.item_tags ?? []).filter((link) => link.item_id === row.id) : null;
        const project = (value: unknown) => Object.fromEntries(fields.split(",").map((key) => [key, (value as Row)[key] ?? null]));
        projected[relation] = Array.isArray(joined) ? joined.map(project) : joined ? project(joined) : null;
      }
      return projected;
    });
    const headers = new Headers(init?.headers);
    if (headers.get("prefer")?.includes("count=exact")) {
      return finish(new Response(init?.method === "HEAD" ? null : JSON.stringify(result), { headers: { "content-range": `${offset}-${offset + result.length - 1}/${total}` } }));
    }
    if (headers.get("accept")?.includes("vnd.pgrst.object")) return finish(Response.json(result[0] ?? null));
    return finish(Response.json(result));
  };
  const client = createClient<Database>("https://synthetic.invalid", "synthetic-test-key", {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { client, requests };
}

function splitTerms(value: string): string[] {
  const parts: string[] = [];
  let depth = 0, quoted = false, escaped = false, start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === "\\") { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (!quoted) {
      if (char === "(") depth++;
      if (char === ")") depth--;
      if (char === "," && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; }
    }
  }
  assert.equal(depth, 0, "balanced PostgREST filter");
  assert.equal(quoted, false, "terminated PostgREST quoted value");
  parts.push(value.slice(start));
  return parts;
}

function logical(expression: string): (row: Row) => boolean {
  const match = /^(and|or)\((.*)\)$/.exec(expression);
  if (!match) return predicate(expression, true);
  const predicates = splitTerms(match[2]).map(logical);
  return match[1] === "and" ? (row) => predicates.every((p) => p(row)) : (row) => predicates.some((p) => p(row));
}

function predicate(expression: string, inLogicalExpression = false): (row: Row) => boolean {
  const match = /^(\w+)\.(not\.)?(eq|neq|gt|gte|lt|lte|is|in|ilike)\.(.*)$/.exec(expression);
  assert.ok(match, `supported filter: ${expression}`);
  const [, column, negation, op, raw] = match;
  const value = inLogicalExpression && raw.startsWith('"') ? JSON.parse(raw) : raw;
  const included = op === "in" ? new Set(splitTerms(raw.slice(1, -1)).map((v) => v.startsWith('"') ? JSON.parse(v) : v)) : null;
  return (row) => {
    const actual = row[column];
    let result: boolean;
    if (op === "is") result = value === "null" && actual == null;
    else if (op === "in") result = included!.has(String(actual));
    else if (actual == null) result = false; // SQL null comparison is not true.
    else if (op === "ilike") {
      const pattern = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
      result = new RegExp(`^${pattern}$`, "i").test(String(actual));
    }
    else {
      const comparison = compare(column, actual, value);
      result = op === "eq" ? comparison === 0 : op === "neq" ? comparison !== 0 : op === "gt" ? comparison > 0 : op === "gte" ? comparison >= 0 : op === "lt" ? comparison < 0 : comparison <= 0;
    }
    return negation ? !result : result;
  };
}

const timestampCache = new Map<string, bigint>();
function compare(column: string, left: unknown, right: unknown): number {
  if (column.endsWith("_at") || column.endsWith("_at_matter")) {
    // PostgreSQL timestamptz comparisons preserve sub-millisecond precision.
    const micros = (value: unknown) => {
      const raw = String(value);
      const cached = timestampCache.get(raw);
      if (cached !== undefined) return cached;
      const remainder = (raw.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6);
      const parsed = Date.parse(raw);
      const result = Number.isFinite(parsed) ? BigInt(parsed) * BigInt(1000) + BigInt(remainder) : BigInt(0);
      timestampCache.set(raw, result);
      return result;
    };
    const a = micros(left), b = micros(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof left === "number") return left - Number(right);
  return Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
}
