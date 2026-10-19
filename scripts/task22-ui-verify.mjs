// Actual production pages + loopback synthetic Data API. No production credentials,
// sync actions, database mutations or upstream Matter calls. Browser regression QA.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { sanitizedEnvironment } from "./stabilization-db-orchestrator.mjs";
assert.ok(
  process.env.TASK22_PLAYWRIGHT_MODULE,
  "Set TASK22_PLAYWRIGHT_MODULE to an existing installed Playwright entry.",
);
const { chromium } = await import(
  pathToFileURL(path.resolve(process.env.TASK22_PLAYWRIGHT_MODULE)).href
);
const testedSourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const output = process.env.TASK22_EVIDENCE_DIR ?? "docs/evidence/task22";
if (output.startsWith("docs/")) {
  assert.equal(
    Boolean(process.env.TASK22_BEHAVIORS_ONLY),
    false,
    "Development subsets must write below work/",
  );
  execFileSync("git", [
    "diff",
    "--exit-code",
    "HEAD",
    "--",
    "app",
    "components",
    "lib",
    "scripts",
    "tests",
    "package.json",
    "package-lock.json",
    "tailwind.config.ts",
  ]);
}
await mkdir(output, { recursive: true });
await mkdir("work", { recursive: true });
const env = sanitizedEnvironment({
  APP_ACCESS_PASSWORD: "synthetic-password",
  APP_CREDENTIAL_VERSION: "1",
  MATTER_API_TOKEN: "synthetic-unused-token",
  SUPABASE_URL: "http://127.0.0.1:54391",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-only",
  CRON_SECRET: "synthetic-unused-cron",
  APP_TIMEZONE: "Europe/Athens",
  NEXT_TELEMETRY_DISABLED: "1",
});
const children = [];
for (const [name, args] of [
  ["fixture", ["scripts/task22-ui-fixture.mjs"]],
  [
    "app",
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3091",
    ],
  ],
]) {
  const log = createWriteStream(`work/task22-ui-${name}.log`);
  const child = spawn(process.execPath, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
}
const origin = "http://localhost:3091",
  api = "http://127.0.0.1:54391";
async function ready(url) {
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("Local QA startup failed");
}
let browser;
const evidence = [],
  pageErrors = [],
  consoleErrors = [],
  scrollChecks = [],
  resourceFailures = [],
  externalRequests = [],
  libraryDetailPrefetches = [],
  checks = [];
const check = (name, details = {}) => {
  checks.push({ name, result: "passed", ...details });
  console.log(`PASS ${name}`);
};
const contrastChecks = [];
async function assertContrast(locator, property = "color") {
  const paint = await locator.evaluate((el, property) => {
    const read = (value) => value.match(/[\d.]+/g).map(Number);
    let background = [255, 255, 255];
    const ancestors = [];
    for (let node = el; node; node = node.parentElement)
      ancestors.unshift(node);
    for (const node of ancestors) {
      const value = read(getComputedStyle(node).backgroundColor);
      const alpha = value[3] ?? 1;
      background = value
        .slice(0, 3)
        .map((value, index) => value * alpha + background[index] * (1 - alpha));
    }
    return {
      foreground: read(getComputedStyle(el)[property]).slice(0, 3),
      background,
      text: el.textContent.trim().slice(0, 80),
    };
  }, property);
  const luminance = (rgb) =>
    rgb
      .map((value) => value / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      )
      .reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0,
      );
  const a = luminance(paint.foreground),
    b = luminance(paint.background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert.ok(
    ratio >= 4.5,
    `${paint.text}: text contrast ${ratio.toFixed(2)}:1 is below 4.5:1`,
  );
  contrastChecks.push({ ...paint, ratio: Number(ratio.toFixed(2)) });
}
try {
  await Promise.all([
    ready("http://127.0.0.1:3091/login"),
    ready(`${api}/info`),
  ]);
  const info = await (await fetch(`${api}/info`)).json();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(info.now));
  const month = today.slice(0, 7);
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const contexts = [];
  const attach = async (width, theme) => {
    const context = await browser.newContext({
      timezoneId: "America/New_York",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      hasTouch: width < 1024,
      reducedMotion: "reduce",
      acceptDownloads: true,
    });
    contexts.push(context);
    await context.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : (externalRequests.push(route.request().url()), route.abort()),
    );
    await context.addCookies([
      {
        name: "matter_stats_session",
        value: "task21-synthetic-session-cookie-only",
        url: origin,
      },
    ]);
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error")
        consoleErrors.push({
          message: message.text(),
          url: message.location().url,
        });
    });
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("request", (request) => {
      if (
        new URL(page.url()).pathname === "/articles" &&
        new URL(request.url()).pathname.startsWith("/articles/") &&
        request.headers()["next-router-prefetch"] === "1"
      ) {
        libraryDetailPrefetches.push(new URL(request.url()).pathname);
      }
    });
    page.on("response", (r) => {
      if (r.status() >= 400)
        resourceFailures.push({
          path: new URL(r.url()).pathname,
          status: r.status(),
        });
    });
    const goto = async (route) => {
      await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        theme === "dark",
      );
      assert.equal(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).colorScheme,
        ),
        theme,
      );
      assert.equal(
        await page.evaluate(
          () => Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
        "America/New_York",
      );
    };
    return { page, goto, context, width, theme };
  };
  async function capture(ui, route, scenario, screenshot) {
    const { page, width, theme } = ui;
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `${width} ${route} overflow`,
    );
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /opaque-not-for-ui|synthetic-server-only/,
    );
    const entry = {
      route,
      scenario,
      width,
      theme,
      height: page.viewportSize().height,
      input:
        scenario === "table-keyboard"
          ? "keyboard"
          : ["selected-day", "presets", "invalid-password"].includes(scenario)
            ? "browser forms / pointer / keyboard"
            : "render / scroll",
      horizontalOverflow: false,
    };
    if (screenshot) {
      const filename = `${scenario}-${route.split("?")[0].replaceAll("/", "") || "root"}-${width}-${theme}.png`;
      await page.screenshot({ path: `${output}/${filename}`, fullPage: false });
      entry.screenshot = filename;
    }
    evidence.push(entry);
  }
  const scenario = async (name) => {
    assert.equal((await fetch(`${api}/scenario?name=${name}`)).status, 200);
  };
  const routes = [
    "/dashboard",
    "/activity",
    "/articles",
    "/articles/synthetic-item-000",
    "/reports?period=yearly&date=2025",
    "/settings",
    "/authors",
    "/sources",
    "/tags",
    "/year-in-reading?year=2025",
    "/login",
  ];
  if (!process.env.TASK22_BEHAVIORS_ONLY)
    for (const width of [390, 768, 1440])
      for (const theme of ["light", "dark"]) {
        const ui = await attach(width, theme);
        for (const route of routes) {
          if (route === "/login") await ui.context.clearCookies();
          await ui.goto(route);
          assert.equal(new URL(ui.page.url()).pathname, route.split("?")[0]);
          if (route === "/settings") {
            for (const badge of await ui.page
              .locator(".text-success,.text-warning,.text-primary")
              .all()) {
              if (await badge.evaluate((el) => el.textContent.trim()))
                await assertContrast(badge);
            }
          }
          if (route === "/login" && theme === "dark") {
            await ui.page
              .getByLabel("Access password")
              .fill("wrong-synthetic-password");
            await ui.page.getByRole("button", { name: "Sign in" }).click();
            const error = ui.page.locator("main").getByRole("alert");
            await error.waitFor();
            await assertContrast(error);
            if (width === 390)
              await capture(ui, route, "invalid-password", true);
          }
          if (
            route.startsWith("/reports") &&
            theme === "dark" &&
            width === 1440
          ) {
            await ui.page.locator(".recharts-rectangle").first().hover();
            const tooltip = ui.page
              .locator(".recharts-default-tooltip")
              .first();
            await tooltip.waitFor();
            await assertContrast(tooltip);
            await assertContrast(tooltip.locator("li").first());
            await assertContrast(
              ui.page.locator(".recharts-cartesian-axis-tick-value").first(),
              "fill",
            );
            await capture(ui, route, "chart-hover", true);
            check("rendered chart tooltip and axis contrast", { width, theme });
          }
          await capture(
            ui,
            route,
            "normal",
            (theme === "light" &&
              [
                "/dashboard",
                "/activity",
                "/articles",
                "/reports?period=yearly&date=2025",
              ].includes(route)) ||
              (theme === "dark" && route === "/articles/synthetic-item-000"),
          );
          if (route === "/articles" && width === 768 && theme === "light") {
            assert.equal(await ui.page.getByRole("row").count(), 101);
            const title = ui.page.getByRole("link", {
              name: "Open Untitled article",
              exact: true,
            });
            await title.focus();
            await ui.page.keyboard.press("Tab");
            await ui.page.keyboard.press("Shift+Tab");
            assert.equal(
              await title.evaluate((el) => el === document.activeElement),
              true,
            );
            assert.notEqual(
              await title.evaluate((el) => getComputedStyle(el).boxShadow),
              "none",
            );
            await capture(ui, route, "table-keyboard", true);
            const tableScroll = ui.page.getByRole("table").locator("..");
            assert.ok(
              await tableScroll.evaluate(
                (el) => el.scrollWidth > el.clientWidth,
              ),
            );
            for (let i = 0; i < 15; i++)
              await ui.page.keyboard.press("ArrowRight");
            await ui.page.waitForFunction(
              () =>
                document.querySelector("table").parentElement.scrollLeft > 0,
            );
            const keyboardScroll = await tableScroll.evaluate(
              (el) => el.scrollLeft,
            );
            for (let i = 0; i < 15; i++)
              await ui.page.keyboard.press("ArrowLeft");
            await ui.page.waitForFunction(
              () =>
                document.querySelector("table").parentElement.scrollLeft === 0,
            );
            await tableScroll.hover();
            await ui.page.mouse.wheel(1000, 0);
            await ui.page.waitForFunction(
              () =>
                document.querySelector("table").parentElement.scrollLeft > 0,
            );
            const trackpadScroll = await tableScroll.evaluate(
              (el) => el.scrollLeft,
            );
            await capture(ui, route, "table-horizontal", true);
            check("Library table horizontal keyboard and trackpad scrolling", {
              width,
              theme,
              keyboardScroll,
              trackpadScroll,
            });
            await title.focus();
            await ui.page.keyboard.press("Enter");
            await ui.page.waitForURL("**/articles/synthetic-item-000");
            await ui.page.goBack();
            await ui.page.waitForURL(`${origin}/articles`);
          }
          const main = ui.page.locator("main");
          const controls = main.locator(
            "a:visible,button:visible,input:visible,select:visible",
          );
          if (await controls.count()) {
            const last = controls.last();
            await last.evaluate((el) => el.scrollIntoView({ block: "center" }));
            const bottomNav = ui.page.locator(".fixed.bottom-0:visible");
            const limit = (await bottomNav.count())
              ? (await bottomNav.boundingBox()).y
              : ui.page.viewportSize().height;
            const rect = await last.boundingBox();
            assert.ok(
              rect && rect.y >= 0 && rect.y + rect.height <= limit,
              `${width} ${route}: last control obstructed`,
            );
            await ui.page.evaluate(() =>
              window.scrollTo(0, document.documentElement.scrollHeight),
            );
            const content = await main
              .locator(":scope > *")
              .last()
              .boundingBox();
            assert.ok(
              content &&
                content.y + content.height > 0 &&
                content.y + content.height <= limit,
              `${width} ${route}: final content obstructed`,
            );
            scrollChecks.push({
              route,
              width,
              theme,
              controlBottom: rect.y + rect.height,
              contentBottom: content.y + content.height,
              availableBottom: limit,
            });
            if (route === "/activity" && width === 390 && theme === "light")
              await capture(ui, route, "scroll-end", true);
          }
          if (route === "/login")
            await ui.context.addCookies([
              {
                name: "matter_stats_session",
                value: "task21-synthetic-session-cookie-only",
                url: origin,
              },
            ]);
        }
        check("route/theme/scroll matrix", {
          width,
          theme,
          routes: routes.length,
        });
        // Native disclosure keyboard semantics, Escape, outside click and route dismissal.
        await ui.goto("/dashboard");
        const nav = ui.page.locator(
          'nav[aria-label="Primary navigation"]:visible',
        );
        assert.equal(
          await nav
            .getByRole("link", { name: "Overview", exact: true })
            .getAttribute("aria-current"),
          "page",
        );
        if (width < 1024) {
          const summary = ui.page.locator("summary");
          await summary.focus();
          await ui.page.keyboard.press("Enter");
          assert.equal(
            await ui.page.locator("details").getAttribute("open"),
            "",
          );
          await ui.page.keyboard.press("Tab");
          assert.equal(
            await ui.page.evaluate(() =>
              document.activeElement.textContent.trim(),
            ),
            "Settings",
          );
          await ui.page.keyboard.press("Tab");
          assert.equal(
            await ui.page.evaluate(() =>
              document.activeElement.textContent.trim(),
            ),
            "Log out",
          );
          await ui.page.keyboard.press("Escape");
          assert.equal(
            await ui.page.locator("details").getAttribute("open"),
            null,
          );
          assert.equal(
            await summary.evaluate((el) => el === document.activeElement),
            true,
          );
          assert.notEqual(
            await summary.evaluate((el) => getComputedStyle(el).boxShadow),
            "none",
          );
          await summary.tap();
          await ui.page
            .getByRole("heading", { level: 1 })
            .tap({ position: { x: 2, y: 2 } });
          assert.equal(
            await ui.page.locator("details").getAttribute("open"),
            null,
          );
          await summary.tap();
          await ui.page
            .locator("details")
            .getByRole("link", { name: "Settings" })
            .tap();
          await ui.page.waitForURL("**/settings");
          assert.equal(
            await ui.page.locator("details").getAttribute("open"),
            null,
          );
          await summary.tap();
          assert.equal(
            await ui.page
              .locator("details")
              .getByRole("link", { name: "Settings" })
              .getAttribute("aria-current"),
            "page",
          );
        } else {
          assert.equal(
            await ui.page
              .locator("aside")
              .getByRole("link", { name: "Settings" })
              .isVisible(),
            true,
          );
          await ui.page
            .locator("aside")
            .getByRole("link", { name: "Settings" })
            .click();
          await ui.page.waitForURL("**/settings");
          assert.equal(
            await ui.page
              .locator("aside")
              .getByRole("link", { name: "Settings" })
              .getAttribute("aria-current"),
            "page",
          );
        }
        if (
          (width === 390 && theme === "light") ||
          (width === 768 && theme === "dark")
        ) {
          for (const control of [
            ui.page.locator("details").getByRole("link", { name: "Settings" }),
            ui.page.locator("details").getByRole("button", { name: "Log out" }),
          ]) {
            const rect = await control.boundingBox();
            assert.ok(
              rect &&
                rect.height >= 44 &&
                rect.x >= 0 &&
                rect.x + rect.width <= width &&
                rect.y >= 0,
            );
          }
          await capture(ui, "/settings", "account", true);
        }
        check("navigation/account keyboard and pointer operation", {
          width,
          theme,
        });
        await ui.context.close();
      }
  // Behavioral URL, forms, history, session pagination and downloaded CSV.
  const ui = await attach(390, "light"),
    { page } = ui;
  await ui.goto("/?start=2025-01-01&end=2025-01-02&context=keep");
  assert.equal(new URL(page.url()).pathname, "/dashboard");
  assert.equal(new URL(page.url()).searchParams.get("end"), "2025-01-02");
  assert.match(await page.locator("main").innerText(), /1 Jan – 2 Jan 2025/);
  await page.getByLabel("Through", { exact: true }).fill("2025-01-03");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await page.waitForURL("**/dashboard?**end=2025-01-03**");
  assert.equal(new URL(page.url()).searchParams.get("context"), "keep");
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.waitForURL("**period=month");
  assert.equal(
    await page
      .getByRole("button", { name: "Month", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.goBack();
  await page.waitForURL("**end=2025-01-03**");
  assert.equal(
    await page.getByLabel("Through", { exact: true }).inputValue(),
    "2025-01-03",
  );
  await page.goForward();
  await page.waitForURL("**period=month");
  await page.reload();
  assert.equal(
    await page
      .getByRole("button", { name: "Month", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  const primary = page.locator('nav[aria-label="Primary navigation"]:visible');
  await primary.getByRole("link", { name: "Activity", exact: true }).click();
  await page.waitForURL("**/activity?period=month");
  await primary.getByRole("link", { name: "Overview", exact: true }).click();
  await page.waitForURL("**/dashboard?period=month");
  assert.equal(
    await page
      .getByRole("button", { name: "Month", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await ui.goto("/dashboard?start=2025-02-02&end=2025-01-01&context=keep");
  assert.match(
    await page.locator("main").getByRole("alert").innerText(),
    /end|Through|after|before/i,
  );
  await page.getByLabel("Through", { exact: true }).fill("2025-02-03");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await page.waitForURL("**end=2025-02-03**");
  assert.equal(new URL(page.url()).searchParams.get("context"), "keep");
  for (const preset of ["today", "week", "month", "year", "all-time"]) {
    await ui.goto(`/dashboard?period=${preset}`);
    assert.match(await page.locator("main").innerText(), /Reading time/);
  }
  await page
    .getByRole("heading", { name: "Your reading", exact: true })
    .scrollIntoViewIfNeeded();
  await capture(ui, "/dashboard", "presets", true);
  check(
    "Overview inclusive range, query preservation, invalid recovery, presets, back/forward/reload",
  );
  await ui.goto(
    "/activity?month=2099-12&day=2099-12-31&page=bogus&context=keep",
  );
  assert.equal(
    await page.getByLabel("Month", { exact: true }).inputValue(),
    month,
  );
  const dayButton = page.getByRole("button", {
    name: new RegExp(`^${today},`),
  });
  assert.equal(await dayButton.isEnabled(), true);
  await dayButton.tap();
  assert.equal(await dayButton.getAttribute("aria-pressed"), "true");
  assert.match(
    await page.getByRole("region", { name: "Selected day" }).innerText(),
    /100 estimated words · 25 sessions/,
  );
  assert.match(await page.locator("main").innerText(), /00:30/);
  for (const button of await page.locator("button[aria-label]").all()) {
    const label = await button.getAttribute("aria-label");
    if (/^\d{4}-\d{2}-\d{2},/.test(label) && label.slice(0, 10) > today)
      assert.equal(await button.isDisabled(), true);
  }
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await page.waitForURL("**page=2");
  assert.equal(new URL(page.url()).searchParams.get("context"), "keep");
  assert.equal(await page.locator("main article").count(), 5);
  assert.match(
    await page.getByRole("region", { name: "Selected day" }).innerText(),
    /100 estimated words · 25 sessions/,
  );
  await page
    .getByRole("region", { name: "Selected day" })
    .scrollIntoViewIfNeeded();
  await capture(ui, "/activity", "selected-day", true);
  await page.reload();
  assert.equal(await dayButton.getAttribute("aria-pressed"), "true");
  await page.getByLabel("Month", { exact: true }).fill("2025-01");
  await page.waitForURL("**month=2025-01**");
  assert.equal(new URL(page.url()).searchParams.has("page"), false);
  assert.equal(new URL(page.url()).searchParams.has("day"), false);
  await ui.goto(`/activity?month=${month}&day=2025-01-01`);
  assert.equal(await dayButton.getAttribute("aria-pressed"), "true");
  check(
    "Activity future/invalid/out-of-month, today, touch selection, page-independent totals and Athens timestamps",
  );
  await ui.goto("/reports?period=yearly&date=2025&context=keep");
  assert.match(
    await page.locator("main").innerText(),
    /Previous year: 2024-01-01 – 2024-12-31/,
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  const csv = await readFile(await download.path(), "utf8");
  assert.equal(download.suggestedFilename(), "matter-stats-yearly-2025.csv");
  assert.equal(csv.split("\n").length, 366);
  assert.equal(
    csv.split("\n")[0],
    "date,reading_time_seconds,estimated_words,sessions",
  );
  assert.match(csv, /2025-01-02,600,2250,1/);
  assert.equal(csv.split("\n").at(-1), "2025-12-31,0,0,0");
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.waitForURL("**period=monthly**");
  assert.equal(new URL(page.url()).searchParams.get("date"), "2025-01");
  assert.equal(new URL(page.url()).searchParams.get("context"), "keep");
  await page.goBack();
  await page.waitForURL("**period=yearly**");
  await page.reload();
  assert.equal(
    await page.getByLabel("Specific report period").inputValue(),
    "2025",
  );
  await page.getByLabel("Specific report period").fill("20");
  await page.getByRole("button", { name: "Apply period" }).click();
  assert.equal(
    await page
      .getByLabel("Specific report period")
      .evaluate((el) => el.validity.patternMismatch),
    true,
  );
  assert.equal(new URL(page.url()).searchParams.get("date"), "2025");
  await page.getByLabel("Specific report period").fill("2024");
  await page.getByRole("button", { name: "Apply period" }).click();
  await page.waitForURL("**date=2024**");
  await page
    .getByRole("link", { name: "Explore your 2024 annual recap →" })
    .click();
  await page.waitForURL("**year-in-reading?year=2024");
  assert.match(await page.locator("h1").innerText(), /2024/);
  await page.reload();
  await page.getByRole("link", { name: "View 2024 report and CSV →" }).click();
  await page.waitForURL("**period=yearly&date=2024");
  await ui.goto("/reports?period=weekly&weekStart=2025-01-02");
  assert.equal(
    await page.getByLabel("Specific report period").inputValue(),
    "2024-12-30",
  );
  await ui.goto("/reports?period=daily&date=2025-01-02");
  assert.equal(
    await page
      .getByRole("button", { name: "Day", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  check(
    "Reports selected year, editable input, comparison labels, legacy deep links, history, recap round trip and canonical CSV",
  );
  await ui.goto("/articles?page=99&context=keep");
  assert.match(
    await page.locator("main").innerText(),
    /Matching library items are available/,
  );
  await page.getByRole("button", { name: "Return to first page" }).click();
  await page.waitForURL("**page=1**");
  assert.equal(new URL(page.url()).searchParams.get("context"), "keep");
  await ui.goto("/articles");
  assert.equal(
    await page.locator("main button h3").first().innerText(),
    "Untitled article",
  );
  assert.equal(
    await page
      .locator("main")
      .getByRole("button", { name: /Untitled article/ })
      .count(),
    1,
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForURL("**page=2");
  assert.equal(
    await page
      .locator("main button")
      .filter({ has: page.locator("h3") })
      .count(),
    5,
  );
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.waitForURL("**page=1");
  const searchDraft = page.getByRole("textbox", {
    name: "Search articles by title, source, or author",
  });
  await searchDraft.fill("Synthetic");
  await page.getByLabel("Author", { exact: true }).fill("Sample author");
  await page.getByLabel("Content type", { exact: true }).focus();
  await page.waitForURL("**author=Sample+author**");
  assert.equal(await searchDraft.inputValue(), "Synthetic");
  await page.getByLabel("Content type", { exact: true }).fill("article");
  await page.getByRole("button", { name: "Search", exact: true }).tap();
  await page.waitForURL(
    (url) =>
      url.searchParams.get("q") === "Synthetic" &&
      url.searchParams.get("type") === "article",
  );
  assert.equal(new URL(page.url()).searchParams.get("author"), "Sample author");
  await ui.goto(
    "/articles?q=Synthetic&source=Example+journal&tag=synthetic-tag&status=queue&author=Sample+author&type=article&size=short",
  );
  assert.match(await page.locator("main").innerText(), /Synthetic article 001/);
  assert.match(await page.locator("main").innerText(), /Matching articles\s+1/);
  await page.getByRole("button", { name: /Synthetic article 001/ }).tap();
  await page.waitForURL("**/articles/synthetic-item-001");
  await page
    .getByText(/Reading sessions are not attributed to this item/)
    .waitFor();
  assert.match(
    await page.locator("main").innerText(),
    /Reading sessions are not attributed/,
  );
  await page.goBack();
  assert.equal(new URL(page.url()).searchParams.get("tag"), "synthetic-tag");
  for (const filter of [
    "status=inbox",
    "author=Missing",
    "type=missing",
    "size=long",
  ]) {
    await ui.goto(`/articles?${filter}`);
    assert.match(
      await page.locator("main").innerText(),
      /Try clearing or broadening/,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Clear filters", exact: true })
        .isVisible(),
      true,
    );
  }
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.waitForURL(`${origin}/articles`);
  for (const route of ["/authors", "/sources", "/tags"]) {
    await ui.goto(route);
    assert.match(
      await page.locator("main").innerText(),
      /attribution is unavailable/,
    );
    assert.doesNotMatch(
      await page.locator("main").innerText(),
      /Sync Matter items with tags|No .* reading data was found/,
    );
  }
  await ui.goto("/year-in-reading");
  assert.doesNotMatch(
    await page.locator("main").innerText(),
    /No .*reading sessions have synced/,
  );
  assert.match(await page.locator("main").innerText(), /25 sessions/);
  check(
    "Library stable pagination, combined filters, empty recovery, nullable details and unsupported attribution",
  );
  // Stored legacy links are synthetic; they do not establish upstream capability.
  await scenario("linked");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const route of ["/authors", "/sources", "/tags"]) {
      await ui.goto(route);
      assert.ok((await page.getByRole("row").count()) > 1);
      const search = page.getByRole("textbox");
      await search.fill("no-match-fixture");
      await page.getByText(/No .* match/).waitFor();
      await search.fill("");
      const sort = page.getByRole("button", {
        name: "Estimated words",
        exact: true,
      });
      await sort.click();
      assert.equal(await sort.getAttribute("aria-pressed"), "true");
      await capture(
        { ...ui, width },
        route,
        "linked",
        width === 768 && route === "/sources",
      );
    }
    await ui.goto(`/year-in-reading?year=${today.slice(0, 4)}`);
    assert.match(
      await page.locator("main").innerText(),
      /Attributed articles\s+2/,
    );
    await capture(
      { ...ui, width },
      "/year-in-reading",
      "linked",
      width === 390,
    );
  }
  check(
    "retained legacy linked rankings, search/sort and distinct annual recap",
    { widths: [390, 768, 1440] },
  );
  await scenario("normal");
  // Independent status/data scenarios, all widths; Task 21 owns every interpretation.
  const expected = {
    normal: /Sessions completion is recent/,
    partial: /Partial ingestion; pending continuation/,
    stale: /Sessions completion is stale/,
    never: /No completed sessions synchronization yet/,
    unknown: /Sessions completion time unknown/,
    "metadata-incomplete": /Sessions completion is recent/,
    "derived-pending": /Updates pending|pending dirty rollups/,
    candidate: /not applied/,
    "status-error": /Sessions status unavailable/,
    "library-error": /Library query unavailable/,
    "metrics-error": /Reading data unavailable/,
    empty: /No imported reading sessions in this period/,
  };
  if (!process.env.TASK22_BEHAVIORS_ONLY)
    for (const [name, pattern] of Object.entries(expected)) {
      await scenario(name);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1000,
        });
        await ui.goto("/dashboard");
        assert.match(await page.locator("main").innerText(), pattern);
        assert.match(
          await page.locator("main").innerText(),
          /Coverage unverified/,
        );
        if (["metrics-error", "library-error", "status-error"].includes(name))
          assert.equal(
            await page
              .getByRole("button", { name: "Month", exact: true })
              .isEnabled(),
            true,
          );
        if (name === "metrics-error")
          assert.match(
            await page.locator("main").innerText(),
            /Synthetic article/,
          );
        else
          assert.match(
            await page.locator("main").innerText(),
            /Estimated words/,
          );
        await capture(
          { ...ui, width },
          "/dashboard",
          name,
          width === 390 &&
            ["partial", "candidate", "metrics-error"].includes(name),
        );
        await ui.goto("/settings");
        assert.match(await page.locator("main").innerText(), /Europe\/Athens/);
        if (name === "derived-pending")
          assert.match(
            await page.locator("main").innerText(),
            /pending dirty rollups/,
          );
        if (name === "candidate")
          assert.match(await page.locator("main").innerText(), /not applied/);
        if (name === "candidate" && width === 768)
          await page
            .getByText("Historical repair", { exact: true })
            .scrollIntoViewIfNeeded();
        await capture(
          { ...ui, width },
          "/settings",
          name,
          width === 768 && name === "candidate",
        );
      }
    }
  await scenario("library-error");
  await ui.goto("/articles");
  assert.doesNotMatch(
    await page.locator("main").innerText(),
    /No articles found/,
  );
  await ui.goto("/articles/synthetic-item-000");
  assert.match(await page.locator("main").innerText(), /Item unavailable/);
  await scenario("metrics-error");
  for (const route of ["/activity", "/reports", "/year-in-reading"]) {
    await ui.goto(route);
    assert.doesNotMatch(
      await page.locator("main").innerText(),
      /No reading activity|You spent 0|No imported sessions/,
    );
  }
  check(
    "independent failures and never/unknown/empty/partial/stale/metadata/derived/candidate status matrix",
  );
  await scenario("normal");
  await page.setViewportSize({ width: 390, height: 844 });
  await ui.goto("/dashboard");
  await page.locator("summary").click();
  await page
    .locator("details")
    .getByRole("button", { name: "Log out" })
    .click();
  await page.waitForURL("**/login");
  assert.equal(
    (await ui.context.cookies()).some((c) => c.name === "matter_stats_session"),
    false,
  );
  await ui.context.addCookies([
    {
      name: "matter_stats_session",
      value: "task21-synthetic-session-cookie-only",
      url: origin,
    },
  ]);
  await ui.goto("/dashboard");
  assert.equal(new URL(page.url()).pathname, "/login");
  await ui.context.clearCookies();
  await page.getByLabel("Access password").fill("wrong-synthetic-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  assert.match(
    await page.locator("main").getByRole("alert").innerText(),
    /Invalid password/,
  );
  await scenario("login-error");
  await page.getByLabel("Access password").fill("synthetic-password");
  let releaseLogin;
  const loginGate = new Promise((resolve) => {
    releaseLogin = resolve;
  });
  await page.route(`${origin}/login`, async (route) => {
    if (route.request().method() === "POST") await loginGate;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Sign in" }).click();
    const pending = page.getByRole("button", {
      name: "Checking...",
      exact: true,
    });
    await pending.waitFor();
    assert.equal(await pending.isDisabled(), true);
  } finally {
    releaseLogin();
  }
  await page.unroute(`${origin}/login`);
  await page
    .locator("main")
    .getByRole("alert")
    .filter({ hasText: /temporarily unavailable/ })
    .waitFor();
  assert.match(
    await page.locator("main").getByRole("alert").innerText(),
    /temporarily unavailable/,
  );
  assert.equal(new URL(page.url()).pathname, "/login");
  await scenario("normal");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  check(
    "synthetic login errors, logout revocation, cookie removal and replay denial",
  );
  const requests = await (await fetch(`${api}/observations`)).json();
  const mutations = requests.filter(
    (r) =>
      !["GET", "HEAD"].includes(r.method) &&
      ![
        "read_matter_generation_status",
        "read_matter_retry_status",
        "read_generation_estimates",
        "read_generation_days",
        "record_app_login_attempt",
        "app_sessions",
      ].includes(r.table),
  );
  assert.deepEqual(mutations, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(libraryDetailPrefetches, []);
  assert.ok(
    consoleErrors.every(
      (error) =>
        error.message ===
          "Failed to load resource: the server responded with a status of 404 (Not Found)" &&
        error.url.endsWith("/favicon.ico"),
    ),
    JSON.stringify(consoleErrors),
  );
  assert.ok(
    resourceFailures.every(
      (r) => r.path === "/favicon.ico" || r.path === "/articles/missing",
    ),
    "Unexpected application resource failure",
  );
  await writeFile(
    `${output}/ui-validation.json`,
    JSON.stringify(
      {
        testedSourceSha,
        syntheticOnly: true,
        productionData: false,
        appTimezone: "Europe/Athens",
        browserTimezone: "America/New_York",
        pages: evidence,
        checks,
        contrastChecks,
        scrollChecks,
        consoleErrors,
        pageErrors,
        resourceFailures,
        externalRequests,
        libraryDetailPrefetches,
        unexpectedMutations: mutations,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Verified ${evidence.length} rendered route/state/viewport/theme combinations and ${checks.length} behavioral groups at ${testedSourceSha}.`,
  );
} finally {
  if (browser) await browser.close();
  for (const child of children) child.kill("SIGTERM");
}
