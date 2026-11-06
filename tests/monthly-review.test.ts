import assert from "node:assert/strict";
import test from "node:test";
import {
  getReadingReport,
  toReportsClientPayload,
} from "../lib/reports-service";
import {
  formatReviewTime,
  monthlyObservations,
  summarizeMonth,
} from "../lib/monthly-review";
import { formatReportCsv } from "../lib/report-csv";
import { cappedPostgrest } from "./fixtures/capped-postgrest";

const now = new Date("2026-11-06T08:00:00Z");
const session = (
  id: string,
  started_at: string,
  duration_seconds: number | null,
) => ({
  id,
  started_at,
  duration_seconds,
  item_id: null,
  ended_at: null,
  words_estimated: 999999,
  matter_items: null,
});
function example(month: string, count: number, days: number, seconds: number) {
  return Array.from({ length: count }, (_, index) =>
    session(
      `${month}-${index}`,
      `${month}-${String((index % days) + 1).padStart(2, "0")}T10:00:00Z`,
      seconds,
    ),
  );
}
const september = example("2026-09", 60, 18, 720);
const august = example("2026-08", 48, 15, 750);
function fixture(
  rows = [...september, ...august],
  settings: {
    cap?: number;
    coverage?: "unknown" | "incomplete" | "pending" | "retry" | "unavailable";
    fail?: "current" | "previous" | "year";
  } = {},
) {
  const coverage = settings.coverage ?? "unknown";
  return cappedPostgrest(
    {
      reading_sessions: rows,
      matter_sync_streams: [
        { stream: "recent_sessions", cycle_active: coverage === "incomplete" },
        { stream: "library_items", cycle_active: false },
      ],
      matter_sync_continuation: [
        {
          account_scope: "matter",
          history_status: coverage === "pending" ? "pending" : "complete",
        },
      ],
    },
    {
      cap: settings.cap ?? 7,
      respond: ({ table, url }) => {
        if (table === "read_matter_retry_status")
          return Response.json({
            pendingRequests: coverage === "retry" ? 1 : 0,
            manualRecovery: false,
          });
        const lower = url.searchParams.get("started_at");
        // Query builders can serialize both bounds under the same key.
        const bounds = url.searchParams.getAll("started_at");
        if (
          table === "reading_sessions" &&
          ((settings.fail === "current" &&
            bounds.includes("gte.2026-08-31T21:00:00.000Z")) ||
            (settings.fail === "previous" &&
              bounds.includes("gte.2026-07-31T21:00:00.000Z")) ||
            (settings.fail === "year" &&
              (lower?.includes("2025-12-31") ||
                bounds.some((value) => value.includes("2025-12-31")))))
        )
          return Response.json(
            { message: "Synthetic read failure" },
            { status: 500 },
          );
        if (coverage === "unavailable" && table === "matter_sync_streams")
          return Response.json(
            { message: "Synthetic status failure" },
            { status: 500 },
          );
      },
    },
  );
}

test("approved September/August example: exact raw totals, S/A, S/N, per-session W and two ordered observations", async () => {
  const f = fixture();
  const report = await getReadingReport(f.client, "monthly", {
    reference: "2026-09",
    now,
  });
  assert.equal(report.metrics.totals.totalReadingTimeSeconds, 43200);
  assert.equal(report.metrics.totals.sessionsCount, 60);
  assert.equal(report.metrics.totals.wordsRead, 162000);
  assert.equal(report.metrics.comparison.totals?.totalReadingTimeSeconds, 36000);
  assert.equal(report.metrics.comparison.totals?.wordsRead, 135024);
  assert.equal(report.metrics.comparison.delta?.totalReadingTimeSeconds, 7200);
  assert.equal(
    report.metrics.comparison.delta?.totalReadingTimePercentChange,
    0.2,
  );
  assert.deepEqual(report.monthlyReview?.current, {
    seconds: 43200,
    sessions: 60,
    activeDays: 18,
    timePerActiveDay: 2400,
    averageSession: 720,
  });
  assert.deepEqual(report.monthlyReview?.previous, {
    seconds: 36000,
    sessions: 48,
    activeDays: 15,
    timePerActiveDay: 2400,
    averageSession: 750,
  });
  assert.deepEqual(report.monthlyReview?.observations, [
    "Imported reading time increased by 2h (20%).",
    "Imported sessions: More active days (18 vs 15), shorter average sessions (12.0 min vs 12.5 min).",
  ]);
  assert.equal(report.metrics.heatmap.length, 30);
  assert.equal(report.metrics.heatmap[29].readingTimeSeconds, 0);
  assert.equal(
    report.metrics.heatmap.reduce(
      (sum, day) => sum + day.readingTimeSeconds,
      0,
    ),
    43200,
  );
  assert.equal(
    report.metrics.heatmap.reduce((sum, day) => sum + day.wordsRead, 0),
    162000,
  );
  assert.ok(report.monthlyTrend?.ok);
  assert.deepEqual(
    report.monthlyTrend.months.map((month) => month.seconds),
    [0, 0, 0, 0, 0, 0, 0, 36000, 43200, 0, 0, 0],
  );
  assert.equal(report.monthlyTrend.months[10].state, "current");
  assert.equal(report.monthlyTrend.months[11].state, "future");
  const csv = formatReportCsv(report.metrics.heatmap).split("\n");
  assert.equal(csv[0], "date,reading_time_seconds,estimated_words,sessions");
  assert.equal(csv.length, 31);
  assert.equal(csv.at(-1), "2026-09-30,0,0,0");
  const detailBounds = f.requests
    .filter(
      (request) =>
        request.table === "reading_sessions" &&
        request.url.searchParams.get("select")?.includes("matter_items"),
    )
    .map((request) => request.url.searchParams.getAll("started_at").join(";"));
  assert.equal(
    new Set(detailBounds).size,
    2,
    "only selected and previous detail scans; no per-date loop or duplicate detail read",
  );
  assert.equal(
    f.requests.some(
      (request) =>
        request.table === "reading_sessions" &&
        !request.url.searchParams
          .getAll("started_at")
          .some((value) => value.startsWith("gte.")),
    ),
    false,
    "monthly Reports does not query all history",
  );
});

test("zero-duration sessions count toward N but not A; three one-second estimates total 12", async () => {
  const rows = [
    session("zero", "2026-09-02T10:00:00Z", 0),
    ...example("2026-09", 3, 1, 1),
  ];
  const report = await getReadingReport(fixture(rows).client, "monthly", {
    reference: "2026-09",
    now,
  });
  assert.deepEqual(report.monthlyReview?.current, {
    seconds: 3,
    sessions: 4,
    activeDays: 1,
    timePerActiveDay: 3,
    averageSession: 0.75,
  });
  assert.equal(report.metrics.totals.wordsRead, 12);
  assert.equal(
    report.monthlyTrend?.ok && report.monthlyTrend.months[8].seconds,
    3,
  );
  assert.equal(formatReviewTime(3), "<1 min");
  assert.equal(formatReviewTime(30), "1 min");
});

test("empty, 0→0, 0→positive, positive→0 and named time-per-active-day fallback", () => {
  const empty = summarizeMonth([], "Europe/Athens");
  const positive = summarizeMonth(
    [session("one", "2026-09-01T10:00:00Z", 60)],
    "Europe/Athens",
  );
  assert.deepEqual(empty, {
    seconds: 0,
    sessions: 0,
    activeDays: 0,
    timePerActiveDay: null,
    averageSession: null,
  });
  assert.deepEqual(monthlyObservations("closed", "unknown", empty, empty), [
    "Imported reading time unchanged: No change (0 in both).",
    "Imported sessions: Active days: 0 vs 0 (0; no change).",
  ]);
  assert.deepEqual(monthlyObservations("closed", "unknown", positive, empty), [
    "Imported reading time increased by 1 min; Up from 0.",
    "Imported sessions: Active days: 1 vs 0 (+1; increase).",
  ]);
  assert.deepEqual(monthlyObservations("closed", "unknown", empty, positive), [
    "Imported reading time decreased by 1 min (100%).",
    "Imported sessions: Active days: 0 vs 1 (-1; decrease).",
  ]);
  assert.equal(
    monthlyObservations("closed", "unknown", positive, positive)[1],
    "Imported sessions: Time per active day: 1 min vs 1 min; active days: 1 vs 1.",
  );
});

for (const coverage of [
  "incomplete",
  "pending",
  "retry",
  "unavailable",
  "unknown",
] as const)
  test(`coverage ${coverage}: imported scope and performance suppression`, async () => {
    const report = await getReadingReport(
      fixture(undefined, { coverage }).client,
      "monthly",
      { reference: "2026-09", now },
    );
    assert.equal(
      report.monthlyReview?.coverage,
      ["incomplete", "pending", "retry"].includes(coverage)
        ? "incomplete"
        : coverage,
    );
    assert.equal(
      report.monthlyReview?.observations.length,
      coverage === "unknown" ? 2 : 0,
    );
  });
for (const [reference, state] of [
  ["2026-11", "current"],
  ["2026-12", "future"],
] as const)
  test(`${state} month: full CSV dates, no comparative claims even with input`, async () => {
    const rows = [
      session("anomaly", `${reference}-28T10:00:00Z`, 600),
      session("old", "2026-10-01T10:00:00Z", 60),
    ];
    const report = await getReadingReport(fixture(rows).client, "monthly", {
      reference,
      now,
    });
    assert.equal(report.monthlyReview?.state, state);
    assert.deepEqual(report.monthlyReview?.observations, []);
    assert.equal(report.monthlyReview?.anomalies.futureOccurrences, 1);
    assert.equal(
      report.metrics.heatmap.at(-1)?.date,
      state === "current" ? "2026-11-30" : "2026-12-31",
    );
  });
for (const fail of ["current", "previous", "year"] as const)
  test(`${fail} read failure stays unavailable, successful independent inputs survive`, async () => {
    const f = fixture(undefined, { fail });
    if (fail === "current") {
      await assert.rejects(
        getReadingReport(f.client, "monthly", { reference: "2026-09", now }),
      );
      return;
    }
    const report = await getReadingReport(f.client, "monthly", {
      reference: "2026-09",
      now,
    });
    assert.equal(report.monthlyReview?.current.seconds, 43200);
    if (fail === "previous") {
      assert.equal(report.monthlyReview?.previous, null);
      assert.equal(report.metrics.comparison.totals, null);
      assert.equal(report.metrics.comparison.delta, null);
      assert.deepEqual(report.monthlyReview?.observations, []);
      assert.equal(
        toReportsClientPayload(report).metrics.comparison.totals,
        null,
      );
      assert.equal(report.metrics.comparison.range?.startDate, "2026-08-01");
    } else assert.equal(report.monthlyTrend?.ok, false);
  });

test("selected year, January→December, leap February, actual month lengths and Athens DST/midnight attribution", async () => {
  const rows = [
    session("dec", "2023-12-31T22:00:00Z", 1),
    session("prev", "2023-12-31T21:59:59Z", 2),
    session("leap", "2024-02-29T21:59:59Z", 60),
    session("march", "2024-02-29T22:00:00Z", 120),
    session("spring", "2024-03-31T00:59:59Z", 300),
    session("spring-after", "2024-03-31T01:00:00Z", 600),
    session("fall", "2024-10-27T00:30:00Z", 1),
    session("fall-after", "2024-10-27T01:30:00Z", 1),
    session("end", "2024-12-31T22:00:00Z", 999),
  ];
  const f = fixture(rows);
  const jan = await getReadingReport(f.client, "monthly", {
    reference: "2024-01",
    now,
  });
  assert.equal(jan.monthlyReview?.current.seconds, 1);
  assert.equal(jan.monthlyReview?.previous?.seconds, 2);
  assert.equal(jan.metrics.comparison.range?.startDate, "2023-12-01");
  const feb = await getReadingReport(f.client, "monthly", {
    reference: "2024-02",
    now,
  });
  assert.equal(feb.metrics.heatmap.length, 29);
  assert.equal(feb.monthlyReview?.current.seconds, 60);
  const march = await getReadingReport(f.client, "monthly", {
    reference: "2024-03",
    now,
  });
  assert.equal(
    march.metrics.range.start?.toISOString(),
    "2024-02-29T22:00:00.000Z",
  );
  assert.equal(
    march.metrics.range.end.toISOString(),
    "2024-03-31T21:00:00.000Z",
  );
  assert.equal(march.monthlyReview?.current.seconds, 1020);
  const april = await getReadingReport(f.client, "monthly", {
    reference: "2024-04",
    now,
  });
  assert.equal(april.metrics.heatmap.length, 30);
  assert.equal(april.metrics.comparison.range?.startDate, "2024-03-01");
  assert.ok(jan.monthlyTrend?.ok);
  assert.equal(jan.monthlyTrend.year, 2024);
  assert.deepEqual(
    jan.monthlyTrend.months.map((month) => month.seconds),
    [1, 60, 1020, 0, 0, 0, 0, 0, 0, 2, 0, 0],
  );
  assert.equal(
    jan.monthlyTrend.months.reduce((sum, month) => sum + month.seconds, 0),
    1083,
  );
});

test("1,203 tied timestamps traverse cap 2 completely; daily/year trend and bounded payload reconcile", async () => {
  const rows = Array.from({ length: 1203 }, (_, index) =>
    session(
      `tie-${String(index).padStart(5, "0")}`,
      "2026-09-01T10:00:00.000001Z",
      1,
    ),
  );
  const report = await getReadingReport(
    fixture(rows, { cap: 2 }).client,
    "monthly",
    { reference: "2026-09", now },
  );
  assert.equal(report.metrics.totals.sessionsCount, 1203);
  assert.equal(report.metrics.totals.totalReadingTimeSeconds, 1203);
  assert.equal(report.metrics.totals.wordsRead, 4812);
  assert.equal(report.metrics.heatmap[0].sessionsCount, 1203);
  const payload = toReportsClientPayload(report);
  assert.equal("timeline" in payload, false);
  assert.equal(
    payload.monthlyTrend?.ok && payload.monthlyTrend.months[8].seconds,
    1203,
  );
  assert.ok(JSON.stringify(payload).length < 15000);
});

test("invalid and NULL durations visibly retained as anomaly counts without changing normalization", async () => {
  const report = await getReadingReport(
    fixture([
      session("negative", "2026-09-01T10:00:00Z", -1),
      session("fraction", "2026-09-01T11:00:00Z", 1.5),
      session("missing", "2026-09-01T12:00:00Z", null),
    ]).client,
    "monthly",
    { reference: "2026-09", now },
  );
  assert.deepEqual(report.monthlyReview?.anomalies, {
    invalidDurations: 2,
    nullDurations: 1,
    futureOccurrences: 0,
  });
  assert.equal(report.metrics.totals.totalReadingTimeSeconds, 2);
  assert.equal(report.monthlyReview?.current.seconds, 2);
});
