// Synthetic local Data API only. Never forwards requests to Supabase or Matter.
// Run after compiling tests. UI runner overrides all app credentials/URLs.
import http from "node:http";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const {
  cappedPostgrest,
} = require("../.test-build/tests/fixtures/capped-postgrest.js");
export const token = "task21-synthetic-session-cookie-only";
let scenario = "normal";
const scenarios = [
  "normal",
  "partial",
  "stale",
  "unavailable",
  "never",
  "unknown",
  "empty",
  "metadata-incomplete",
  "metrics-error",
  "library-error",
  "status-error",
  "derived-pending",
  "candidate",
  "login-error",
];
const authRows = [],
  revoked = new Set();
const requests = [];
const now = new Date(),
  iso = (ms) => new Date(ms).toISOString(),
  ago = (h) => iso(now.getTime() - h * 3600000);
const tables = () => {
  const partial = scenario === "partial",
    stale = scenario === "stale";
  const streams = ["recent_sessions", "library_items"].map((stream) => ({
    stream,
    endpoint: stream === "recent_sessions" ? "/reading_sessions" : "/items",
    filters: {},
    page_limit: 25,
    cursor: partial ? "opaque-not-for-ui" : null,
    cycle_started_at: partial ? ago(1) : null,
    cycle_active: partial,
    cycle_generation: 3,
    completed_watermark: scenario === "never" ? null : ago(72),
    retry_at: partial ? iso(now.getTime() + 300000) : null,
    transition_status: "native",
    coverage_window: "current_year",
  }));
  return {
    app_sessions: [
      ...authRows,
      {
        token_hash: createHash("sha256").update(token).digest("hex"),
        expires_at: iso(now.getTime() + 3600000),
        revoked_at: revoked.has(
          createHash("sha256").update(token).digest("hex"),
        )
          ? ago(0.01)
          : null,
        credential_version: 1,
      },
    ],
    matter_sync_streams: streams,
    matter_sync_continuation: [
      {
        account_scope: "matter",
        history_status: partial ? "running" : "none",
        requested_at: partial ? ago(2) : null,
      },
    ],
    matter_cycle_completions: ["never", "unknown"].includes(scenario)
      ? []
      : [
          {
            stream: "recent_sessions",
            cycle_generation: 2,
            source_boundary: ago(72),
            completed_at: ago(stale ? 48 : 2),
          },
          {
            stream: "library_items",
            cycle_generation: 2,
            source_boundary: ago(72),
            completed_at: ago(24),
          },
        ].filter(
          (row) =>
            scenario !== "metadata-incomplete" ||
            row.stream === "recent_sessions",
        ),
    matter_invocation_status: [
      {
        id: "synthetic-invocation",
        trigger: "manual",
        attempted_at: ago(0.1),
        finished_at: ago(0.05),
        outcome: partial || stale ? "partial" : "complete",
      },
    ],
    matter_sync_leases: [
      {
        account_scope: "matter",
        expires_at: partial ? iso(now.getTime() + 60000) : null,
      },
    ],
    sync_runs: [
      {
        id: "synthetic-run",
        started_at: ago(0.1),
        finished_at: ago(0.05),
        status: "success",
        matter_has_more: partial || stale,
        items_synced: 2,
        sessions_synced: 3,
        sync_mode: "recent_activity",
        error_message: null,
      },
    ],
    matter_items:
      scenario === "empty"
        ? []
        : Array.from({ length: 105 }, (_, index) => ({
            id: `synthetic-item-${String(index).padStart(3, "0")}`,
            title:
              index === 0
                ? null
                : `Synthetic article ${String(index).padStart(3, "0")}`,
            url: null,
            source: index % 2 ? "Example journal" : "Sample review",
            author: index % 2 ? "Sample author" : null,
            word_count: index % 3 ? 1200 : null,
            estimated_reading_time_minutes: index % 3 ? 6 : null,
            status: index % 2 ? "queue" : "archive",
            content_type: "article",
            progress: index % 3 ? 0.3 : null,
            created_at_matter: iso(now.getTime() - index * 3600000),
            updated_at_matter: ago(1),
            updated_at: ago(1),
          })),
    matter_tags: [{ id: "synthetic-tag", name: "Science" }],
    reading_sessions:
      scenario === "empty"
        ? []
        : [
            ...Array.from({ length: 25 }, (_, index) => ({
              id: `synthetic-session-${String(index).padStart(2, "0")}`,
              started_at: new Date(
                new Intl.DateTimeFormat("en-CA", {
                  timeZone: "Europe/Athens",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                }).format(now) + "T00:30:00+03:00",
              ).toISOString(),
              duration_seconds: 1,
              item_id: null,
            })),
            {
              id: "historical-session",
              started_at: "2025-01-01T22:30:00Z",
              duration_seconds: 600,
              item_id: null,
            },
          ],
    daily_stats: [],
    annotations: [],
    item_tags: [{ item_id: "synthetic-item-001", tag_id: "synthetic-tag" }],
    matter_dirty_rollups:
      partial || scenario === "derived-pending"
        ? [{ date: now.toISOString().slice(0, 10) }]
        : [],
    sync_state: [],
  };
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/scenario") {
    const next = url.searchParams.get("name");
    if (!scenarios.includes(next)) {
      res.writeHead(400).end();
      return;
    }
    scenario = next;
    res.end("synthetic");
    return;
  }
  if (url.pathname === "/info") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ now: now.toISOString(), scenario, scenarios }));
    return;
  }
  const table = url.pathname.split("/").at(-1);
  requests.push({ method: req.method, table });
  if (url.pathname === "/observations") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(requests));
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  if (table === "record_app_login_attempt") {
    res.setHeader("Content-Type", "application/json");
    if (scenario === "login-error") {
      res
        .writeHead(500)
        .end(JSON.stringify({ message: "Synthetic unavailable" }));
      return;
    }
    res.end("true");
    return;
  }
  if (table === "app_sessions" && req.method === "POST") {
    authRows.push({ ...JSON.parse(body), revoked_at: null });
    res.writeHead(201).end();
    return;
  }
  if (table === "app_sessions" && req.method === "PATCH") {
    const hash = url.searchParams.get("token_hash")?.slice(3);
    revoked.add(hash);
    for (const row of authRows)
      if (row.token_hash === hash) row.revoked_at = JSON.parse(body).revoked_at;
    res.writeHead(204).end();
    return;
  }
  if (
    !["GET", "HEAD"].includes(req.method) &&
    ![
      "read_matter_generation_status",
      "read_matter_retry_status",
      "read_generation_estimates",
      "read_generation_days",
    ].includes(table)
  ) {
    res.writeHead(405).end("Synthetic QA refuses mutations");
    return;
  }

  const fixture = cappedPostgrest(tables(), {
    respond: ({ table }) => {
      if (
        (scenario === "metrics-error" && table === "reading_sessions") ||
        (scenario === "library-error" && table === "matter_items") ||
        (scenario === "status-error" && table === "matter_cycle_completions") ||
        (scenario === "metadata-incomplete" && table === "matter_items")
      )
        return Response.json(
          { code: "XX000", message: "Synthetic unavailable query" },
          { status: 500 },
        );
      if (
        scenario === "unavailable" &&
        [
          "matter_cycle_completions",
          "matter_items",
          "matter_dirty_rollups",
          "read_matter_generation_status",
        ].includes(table)
      )
        return Response.json(
          { code: "XX000", message: "Synthetic unavailable query" },
          { status: 500 },
        );
      if (table === "read_matter_generation_status")
        return Response.json({
          activeId: "synthetic-generation",
          epoch: "2",
          frozen: false,
          rolledBack: false,
          active: {
            id: "synthetic-generation",
            state: "live",
            timezone: "Europe/Athens",
            wordMethod: "session-duration-225-round-v1",
            calendarMethod: "local-occurrence-day-v1",
            readinessAt: ago(24),
            reconciled: true,
            baseline: false,
            cutover: true,
          },
          candidate:
            scenario === "candidate"
              ? {
                  id: "synthetic-candidate",
                  state: "ready",
                  timezone: "Europe/Athens",
                  reconciled: true,
                  pendingChanges: false,
                  readinessAt: ago(1),
                }
              : null,
        });
      if (table === "read_matter_retry_status")
        return Response.json({
          nextEligibleAt:
            scenario === "partial" ? iso(now.getTime() + 300000) : null,
          manualRecovery: false,
          pendingRequests: scenario === "partial" ? 1 : 0,
        });
    },
  });
  try {
    const response = await fixture.fetch(`http://synthetic.invalid${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: body || undefined,
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500).end("Synthetic fixture failure");
  }
});
server.listen(54391, "127.0.0.1", () =>
  console.log("Synthetic Task 22 Data API listening on 127.0.0.1:54391"),
);
