import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".test-build");
const require = Module.createRequire(import.meta.url);
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
let client;
// Same isolated CommonJS boundary technique as auth-entrypoints.test.mjs.
// Stub only admin-client creation; execute the real daily-stat service/query.
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith("@/")) request = path.join(root, request.slice(2)) + ".js";
  return originalResolve.call(this, request, parent, ...rest);
};
Module._load = function(request, parent, ...rest) {
  if (request === "./supabase-admin" && parent?.filename === path.join(root, "lib/daily-stats.js")) return { getSupabaseAdminClient: () => client };
  if (request === "./matter-sync-lease" && parent?.filename === path.join(root, "lib/daily-stats.js")) return {};
  return originalLoad.call(this, request, parent, ...rest);
};
const { calculateDailyStat } = require(path.join(root, "lib/daily-stats.js"));
const { cappedPostgrest } = require(path.join(root, "tests/fixtures/capped-postgrest.js"));
Module._load = originalLoad;
Module._resolveFilename = originalResolve;

test("daily annotation exact count remains complete under a response cap", async () => {
  const annotations = Array.from({ length: 10037 }, (_, i) => ({ id: `a-${i}`, item_id: "item", created_at_matter: "2026-09-10T10:00:00Z" }));
  for (const cap of [100, 300, 1000]) {
    const fixture = cappedPostgrest({ annotations }, { cap });
    client = fixture.client;
    const result = await calculateDailyStat("2026-09-10", "UTC");
    assert.equal(result.highlights_count, annotations.length);
    assert.equal(fixture.requests.filter((r) => r.table === "annotations").length, 1);
  }
});

test("daily annotation invalid count and database errors never become successful zero counts", async () => {
  for (const fault of ["missing-count", "negative-count", "database-error"]) {
    const fixture = cappedPostgrest({}, { respond: (r) => {
      if (r.table !== "annotations") return;
      if (fault === "database-error") return Response.json({ message: "count failed", code: "XX000" }, { status: 500 });
      return new Response(null, { headers: fault === "negative-count" ? { "content-range": "0-0/-1" } : {} });
    } });
    client = fixture.client;
    await assert.rejects(calculateDailyStat("2026-09-10", "UTC"), (e) => /Invalid complete annotation count|count failed/.test(e.message));
  }
});
