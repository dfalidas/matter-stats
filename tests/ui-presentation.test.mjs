import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  root = path.join(repo, ".test-build");
const require = Module.createRequire(import.meta.url),
  originalLoad = Module._load,
  originalResolve = Module._resolveFilename;
const { cappedPostgrest } = require(
  path.join(root, "tests/fixtures/capped-postgrest.js"),
);
const React = require("react");
let stateOverrides;
let client,
  pathname = "/dashboard",
  params = new URLSearchParams(),
  pushed;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "server-only")
    return path.join(repo, "tests/fixtures/server-only.cjs");
  if (request.startsWith("@/"))
    request = path.join(root, request.slice(2)) + ".js";
  return originalResolve.call(this, request, parent, ...rest);
};
Module._load = function (request, parent, ...rest) {
  if (request === "react")
    return {
      ...React,
      useTransition: () => [false, (fn) => fn()],
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useState: (value) => [
        stateOverrides?.length ? stateOverrides.shift() : value,
        () => {},
      ],
    };
  if (request === "next/navigation")
    return {
      usePathname: () => pathname,
      useSearchParams: () => params,
      useRouter: () => ({
        push: (href) => {
          pushed = href;
        },
      }),
      notFound: () => {
        throw new Error("not-found");
      },
      redirect: (href) => {
        throw new Error(`redirect:${href}`);
      },
    };
  if (request === "@/lib/supabase-admin")
    return { getSupabaseAdminClient: () => client };
  if (request === "@/lib/require-auth")
    return { requireAccessSession: async () => {} };
  return originalLoad.call(this, request, parent, ...rest);
};
const { ArticlesLibrary } = require(
  path.join(root, "app/articles/articles-library.js"),
);
const { DashboardOverview } = require(
  path.join(root, "app/dashboard/dashboard-overview.js"),
);
const { ReportsOverview } = require(
  path.join(root, "app/reports/reports-overview.js"),
);
const reportsPage = require(path.join(root, "app/reports/page.js")).default;
const { formatReportCsv } = require(path.join(root, "lib/report-csv.js"));
const { AppNavigation } = require(
  path.join(root, "app/_components/app-navigation.js"),
);
const detailPage = require(
  path.join(root, "app/articles/[id]/page.js"),
).default;
const yearPage = require(
  path.join(root, "app/year-in-reading/page.js"),
).default;
const home = require(path.join(root, "app/page.js")).default;
Module._load = originalLoad;
Module._resolveFilename = originalResolve;
function all(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((n) => all(n, predicate));
  return [
    ...(predicate(node) ? [node] : []),
    ...all(node.props?.children, predicate),
  ];
}
const button = (tree, label) =>
  all(tree, (n) => n.type === "button" && n.props.children === label)[0];
test("Overview period controls remain operable during independent metrics failure and preserve URL context", () => {
  pathname = "/dashboard";
  params = new URLSearchParams("period=month&context=keep");
  const view = DashboardOverview({
    period: "month",
    fallbackDate: "2026-10-19",
    metricsResult: {
      ok: false,
      message: "Unavailable",
      library: { state: "known", value: [] },
    },
  });
  assert.equal(button(view, "Month").props["aria-pressed"], true);
  button(view, "Custom").props.onClick();
  assert.equal(
    pushed,
    "/dashboard?context=keep&start=2026-10-19&end=2026-10-19",
  );
});
test("report frequency conversions retain the selected calendar year and unrelated parameters", () => {
  pathname = "/reports";
  params = new URLSearchParams("period=yearly&date=2025&context=keep");
  const view = ReportsOverview({
    period: "yearly",
    reference: "2025",
    reportsResult: { ok: false, message: "Unavailable" },
  });
  button(view, "Month").props.onClick();
  assert.equal(pushed, "/reports?period=monthly&date=2025-01&context=keep");
  button(view, "Day").props.onClick();
  assert.equal(pushed, "/reports?period=daily&date=2025-01-01&context=keep");
});
test("primary navigation preserves its own deep link without sharing incompatible report periods", () => {
  pathname = "/reports";
  params = new URLSearchParams("period=yearly&date=2025");
  const links = all(AppNavigation({}), (n) => n.props?.href);
  assert.equal(
    links.find((n) => n.props.children.at(-1).props.children === "Reports")
      .props.href,
    "/reports?period=yearly&date=2025",
  );
  assert.equal(
    links.find((n) => n.props.children.at(-1).props.children === "Overview")
      .props.href,
    "/dashboard",
  );
  assert.equal(
    links.find((n) => n.props.children.at(-1).props.children === "Activity")
      .props.href,
    "/activity",
  );
  for (const [current, target, destination] of [
    ["/dashboard", "Activity", "/activity"],
    ["/activity", "Overview", "/dashboard"],
  ]) {
    pathname = current;
    params = new URLSearchParams("period=month&context=keep");
    const compatibleLinks = all(AppNavigation({}), (n) => n.props?.href);
    assert.equal(
      compatibleLinks.find(
        (n) => n.props.children.at(-1).props.children === target,
      ).props.href,
      `${destination}?period=month`,
    );
    assert.equal(
      compatibleLinks.find((n) => n.props["aria-current"] === "page").props
        .href,
      `${current}?period=month&context=keep`,
    );
  }
});
test("article detail distinguishes query failure from a missing item and does not decode a valid percent ID twice", async () => {
  client = cappedPostgrest(
    {},
    {
      respond: ({ table }) =>
        table === "matter_items"
          ? Response.json({ message: "private-query-error" }, { status: 500 })
          : undefined,
    },
  ).client;
  const unavailable = await detailPage({
    params: Promise.resolve({ id: "synthetic%item" }),
  });
  assert.equal(unavailable.props.title, "Item unavailable");
  assert.doesNotMatch(
    JSON.stringify(unavailable.props, (key, value) =>
      key === "type" ? undefined : value,
    ),
    /private-query-error/,
  );
  const percentFixture = cappedPostgrest({
    matter_items: [
      {
        id: "synthetic%item",
        title: null,
        source: null,
        author: null,
        progress: null,
        tags: [],
      },
    ],
  });
  client = percentFixture.client;
  const present = await detailPage({
    params: Promise.resolve({ id: "synthetic%item" }),
  });
  assert.equal(present.props.title, "Untitled item");
  assert.ok(
    percentFixture.requests.some(
      (request) => request.url.searchParams.get("id") === "eq.synthetic%item",
    ),
  );
  client = cappedPostgrest({}).client;
  await assert.rejects(
    detailPage({ params: Promise.resolve({ id: "missing" }) }),
    /not-found/,
  );
});
test("annual recap keeps selected year through an empty successful query and independent query failure", async () => {
  client = cappedPostgrest({}).client;
  const empty = await yearPage({
    searchParams: Promise.resolve({ year: "2025" }),
  });
  const recap = all(empty, (n) => n.props?.recapResult)[0];
  assert.equal(recap.props.year, 2025);
  assert.equal(recap.props.recapResult.ok, true);
  assert.equal(recap.props.recapResult.report.metrics.totals.sessionsCount, 0);
  client = cappedPostgrest(
    {},
    {
      respond: ({ table }) =>
        table === "reading_sessions"
          ? Response.json({ message: "private-query-error" }, { status: 500 })
          : undefined,
    },
  ).client;
  const unavailable = await yearPage({
    searchParams: Promise.resolve({ year: "2025" }),
  });
  assert.equal(
    all(unavailable, (n) => n.props?.recapResult)[0].props.recapResult.ok,
    false,
  );
  assert.equal(unavailable.props.title, "Your 2025 in Reading");
});
test("root Overview alias preserves range and repeated URL parameters", async () => {
  await assert.rejects(
    home({
      searchParams: Promise.resolve({
        start: "2025-01-01",
        end: "2025-01-02",
        context: ["a", "b"],
      }),
    }),
    /redirect:\/dashboard\?start=2025-01-01&end=2025-01-02&context=a&context=b/,
  );
});

const libraryResult = {
  articles: [],
  total: 105,
  page: 99,
  pageSize: 100,
  filters: {
    period: "all-time",
    query: "",
    source: "Science",
    tag: "",
    status: "all",
    author: "",
    contentType: "",
    size: "",
    page: 99,
  },
  sources: [{ value: "Science", label: "Science" }],
  tags: [],
};
test("out-of-range Library pages offer a first-page recovery while retaining filters", () => {
  pathname = "/articles";
  params = new URLSearchParams("source=Science&page=99&context=keep");
  const view = ArticlesLibrary({
    result: libraryResult,
    timezone: "Europe/Athens",
  });
  const recovery = all(
    view,
    (node) => node.props?.children === "Return to first page",
  )[0];
  recovery.props.onClick();
  assert.equal(pushed, "/articles?source=Science&page=1&context=keep");
});
test("Library keeps native table rows and actual title links for keyboard navigation", () => {
  const result = {
    ...libraryResult,
    page: 1,
    articles: [
      {
        id: "synthetic-item",
        title: "An example",
        source: null,
        author: null,
        status: null,
        word_count: null,
        estimated_reading_time_minutes: null,
        progress: null,
        created_at_matter: null,
        updated_at_matter: null,
        highlights: 0,
        tags: [],
      },
    ],
  };
  const view = ArticlesLibrary({ result, timezone: "Europe/Athens" });
  const rows = all(view, (node) => node.type?.displayName === "TableRow");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.props.role === undefined));
  const link = all(
    view,
    (node) => node.props?.href === "/articles/synthetic-item",
  )[0];
  assert.equal(link.props["aria-label"], "Open An example");
  let stopped = false;
  link.props.onClick({
    stopPropagation: () => {
      stopped = true;
    },
  });
  assert.equal(stopped, true);
});

test("Library search submits draft text, author and content type together without losing other filters", () => {
  pathname = "/articles";
  params = new URLSearchParams("source=Science&page=2&context=keep");
  stateOverrides = ["Synthetic", "Sample author", "article"];
  try {
    const view = ArticlesLibrary({
      result: libraryResult,
      timezone: "Europe/Athens",
    });
    all(view, (node) => node.type === "form")[0].props.onSubmit({
      preventDefault() {},
    });
    const next = new URL(pushed, "https://synthetic.invalid");
    assert.equal(next.searchParams.get("q"), "Synthetic");
    assert.equal(next.searchParams.get("author"), "Sample author");
    assert.equal(next.searchParams.get("type"), "article");
    assert.equal(next.searchParams.get("source"), "Science");
    assert.equal(next.searchParams.get("context"), "keep");
    assert.equal(next.searchParams.has("page"), false);
  } finally {
    stateOverrides = undefined;
  }
});

// Exercise the real page validation, report service, calendar ranges and bounded
// client payload with successful synthetic Data API responses, then UI handlers.
const boundarySessions = [
  ["previous", "2024-12-23T12:00:00Z", 60],
  ["week-start", "2024-12-29T22:00:00Z", 1],
  ["january", "2025-01-01T22:30:00Z", 600],
  ["week-end", "2025-01-05T22:00:00Z", 120],
  ["february", "2025-02-23T22:00:00Z", 61],
  ["march", "2025-03-01T12:00:00Z", 1],
  ["march-week-end", "2025-03-02T22:00:00Z", 120],
  ["leap", "2024-02-29T12:00:00Z", 60],
].map(([id, started_at, duration_seconds]) => ({
  id,
  started_at,
  duration_seconds,
  item_id: null,
  ended_at: null,
  words_estimated: 999999,
  matter_items: null,
}));
async function reportView(query, unavailable = false) {
  pathname = "/reports";
  params = new URLSearchParams(query);
  const search = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    search[key] = values.length === 1 ? values[0] : values;
  }
  client = cappedPostgrest(
    { reading_sessions: boundarySessions },
    unavailable
      ? {
          respond: ({ table }) =>
            table === "reading_sessions"
              ? Response.json({ message: "synthetic outage" }, { status: 500 })
              : undefined,
        }
      : {},
  ).client;
  const page = await reportsPage({ searchParams: Promise.resolve(search) });
  const props = all(page, (node) => node.type === ReportsOverview)[0].props;
  assert.equal(props.reportsResult.ok, !unavailable);
  return { view: ReportsOverview(props), ...props };
}
const referenceInput = (view) =>
  all(view, (n) => n.props?.name === "reference")[0];
const recap = (view) =>
  all(view, (n) => n.props?.href?.startsWith("/year-in-reading?"))[0];
function followReport(view, label) {
  button(view, label).props.onClick();
  return new URL(pushed, "https://synthetic.invalid").search.slice(1);
}
function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  return node && typeof node === "object"
    ? textContent(node.props?.children)
    : String(node ?? "");
}
test("successful year to week to year retains calendar selection and recap while weekly ranges, comparisons and CSV stay canonical", async () => {
  const annual = await reportView(
    "period=yearly&date=2025&context=keep&context=again",
  );
  const weekly = await reportView(followReport(annual.view, "Week"));
  assert.equal(referenceInput(weekly.view).props.defaultValue, "2025-01-01");
  assert.equal(recap(weekly.view).props.href, "/year-in-reading?year=2025");
  const m = weekly.reportsResult.report.metrics;
  assert.equal(m.range.startDate, "2024-12-30");
  assert.equal(m.range.endDate, "2025-01-06");
  assert.equal(m.range.start.toISOString(), "2024-12-29T22:00:00.000Z");
  assert.equal(m.range.end.toISOString(), "2025-01-05T22:00:00.000Z");
  assert.equal(m.comparison.range.startDate, "2024-12-23");
  assert.equal(m.comparison.range.endDate, "2024-12-30");
  assert.equal(m.comparison.totals.totalReadingTimeSeconds, 60);
  assert.equal(m.totals.totalReadingTimeSeconds, 601);
  assert.equal(m.totals.wordsRead, 2254);
  assert.equal(m.totals.sessionsCount, 2);
  assert.match(
    textContent(weekly.view),
    /Previous week: 2024-12-23 – 2024-12-29/,
  );
  const csv = formatReportCsv(m.heatmap);
  assert.match(csv, /2024-12-30,1,4,1/);
  assert.match(csv, /2025-01-02,600,2250,1/);
  assert.equal(csv.split("\n").length, 8);
  assert.equal(csv.split("\n").at(-1), "2025-01-05,0,0,0");
  const query = followReport(weekly.view, "Year");
  assert.deepEqual(new URLSearchParams(query).getAll("context"), [
    "keep",
    "again",
  ]);
  const back = await reportView(query);
  assert.equal(referenceInput(back.view).props.defaultValue, "2025");
  assert.equal(recap(back.view).props.href, "/year-in-reading?year=2025");
});
test("successful March to week to month retains March across February and leap-day boundaries", async () => {
  for (const [year, monday, end, seconds, words] of [
    ["2025", "2025-02-24", "2025-03-03", 62, 233],
    ["2024", "2024-02-26", "2024-03-04", 60, 225],
  ]) {
    const monthly = await reportView(`period=monthly&date=${year}-03`);
    const weekly = await reportView(followReport(monthly.view, "Week"));
    assert.equal(
      referenceInput(weekly.view).props.defaultValue,
      `${year}-03-01`,
    );
    const m = weekly.reportsResult.report.metrics;
    assert.equal(m.range.startDate, monday);
    assert.equal(m.range.endDate, end);
    assert.equal(m.totals.totalReadingTimeSeconds, seconds);
    assert.equal(m.totals.wordsRead, words);
    if (year === "2024")
      assert.match(formatReportCsv(m.heatmap), /2024-02-29,60,225,1/);
    const back = await reportView(followReport(weekly.view, "Month"));
    assert.equal(referenceInput(back.view).props.defaultValue, `${year}-03`);
  }
});
test("explicit Apply replaces the retained calendar reference after a frequency switch", async () => {
  const annual = await reportView(
    "period=yearly&date=2025&context=a&context=b",
  );
  const weekly = await reportView(followReport(annual.view, "Week"));
  const originalFormData = globalThis.FormData;
  globalThis.FormData = class {
    get() {
      return "2024-02-29";
    }
  };
  try {
    all(weekly.view, (node) => node.type === "form")[0].props.onSubmit({
      preventDefault() {},
      currentTarget: {},
    });
  } finally {
    globalThis.FormData = originalFormData;
  }
  const changed = await reportView(
    new URL(pushed, "https://synthetic.invalid").search.slice(1),
  );
  assert.equal(referenceInput(changed.view).props.defaultValue, "2024-02-29");
  assert.equal(recap(changed.view).props.href, "/year-in-reading?year=2024");
  assert.equal(
    changed.reportsResult.report.metrics.range.startDate,
    "2024-02-26",
  );
  const monthly = await reportView(followReport(changed.view, "Month"));
  assert.equal(referenceInput(monthly.view).props.defaultValue, "2024-02");
  assert.deepEqual(params.getAll("context"), ["a", "b"]);
});
test("missing and invalid references use local today consistently; legacy and repeated references use existing first-value validation even during outage", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2025-03-01T00:30:00Z"),
  });
  try {
    for (const query of [
      "period=weekly",
      "period=weekly&date=2025-02-29",
      "period=weekly&date=bad&weekStart=2024-01-01",
    ]) {
      for (const unavailable of [false, true]) {
        const result = await reportView(query, unavailable);
        assert.equal(result.reference, "2025-03-01");
        assert.equal(
          new URLSearchParams(followReport(result.view, "Month")).get("date"),
          "2025-03",
        );
      }
    }
    for (const unavailable of [false, true]) {
      const legacy = await reportView(
        "period=weekly&weekStart=2025-01-02&context=a&context=b",
        unavailable,
      );
      assert.equal(legacy.reference, "2025-01-02");
      const next = new URLSearchParams(followReport(legacy.view, "Year"));
      assert.equal(next.get("date"), "2025");
      assert.equal(next.has("weekStart"), false);
      assert.deepEqual(next.getAll("context"), ["a", "b"]);
    }
    const repeated = await reportView(
      "period=weekly&date=2025-01-01&date=2024-01-01",
    );
    assert.equal(repeated.reference, "2025-01-01");
  } finally {
    t.mock.timers.reset();
  }
});
