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
