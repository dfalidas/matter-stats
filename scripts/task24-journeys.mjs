import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { seedSql, expectedRows, sessions } from "./task24-fixtures.mjs";

export const JOURNEYS = [
  "authentication",
  "analytics-csv",
  "navigation-library",
  "sync-continuation",
  "sync-faults",
  "truthful-status",
  "logout-replay",
];
const cookieName = "matter_stats_session";
const hash = (value) => createHash("sha256").update(value).digest("hex");

export async function runJourneys({
  browser,
  origin,
  credentials,
  sql,
  state,
  observations,
  startApp,
  output,
  phases,
  save,
  secrets,
}) {
  const checks = [],
    screenshots = [],
    browserEvents = {
      pageErrors: 0,
      consoleErrors: [],
      unexpectedRequests: 0,
      failedResources: [],
    };
  const check = (name, detail = {}) => {
    checks.push({ name, status: "passed", ...detail });
    save("journeys", {
      checks,
      counts: { passed: checks.length, failed: 0, skipped: 0, todo: 0 },
      screenshots,
    });
    console.log(`PASS ${name}`);
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/New_York",
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(20000);
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    browserEvents.unexpectedRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", () => browserEvents.pageErrors++);
  page.on("console", (message) => {
    if (message.type() === "error")
      browserEvents.consoleErrors.push({
        kind: message.text().startsWith("Failed to load resource")
          ? "resource"
          : "other",
      });
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      browserEvents.failedResources.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  const text = () => page.locator("main").innerText();
  const goto = async (route) => {
    await page.goto(origin + route, { waitUntil: "networkidle" });
  };
  const safe = async () => {
    const html = await page.content();
    for (const value of secrets)
      assert.ok(!html.includes(value), "secret in browser content");
    assert.ok(
      !html.includes("task24-page-"),
      "durable cursor in browser content",
    );
  };
  const capture = async (name) => {
    await safe();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "horizontal overflow",
    );
    const filename = `${name}.png`;
    await page.screenshot({ path: `${output}/${filename}` });
    screenshots.push({
      filename,
      route: new URL(page.url()).pathname,
      width: page.viewportSize().width,
      visualInspection: "pending",
    });
  };
  let clientIdentity = 0;
  const login = async () => {
    await context.clearCookies();
    await context.setExtraHTTPHeaders({
      "x-forwarded-for": `127.24.0.${++clientIdentity}`,
    });
    await goto("/login");
    await page.getByLabel("Access password").fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/dashboard");
    const cookie = (await context.cookies()).find(
      (row) => row.name === cookieName,
    );
    assert.ok(cookie, "login must issue a cookie");
    assert.ok(
      cookie.secure &&
        cookie.httpOnly &&
        cookie.sameSite === "Lax" &&
        cookie.path === "/",
    );
    assert.ok(cookie.expires > Date.now() / 1000 + 29 * 86400);
    secrets.push(cookie.value);
    assert.equal(
      await page.evaluate(() => window.isSecureContext),
      true,
      "localhost must be a trustworthy browser context",
    );
    assert.equal(
      await page.evaluate(() =>
        document.cookie.includes("matter_stats_session"),
      ),
      false,
    );
    assert.equal(
      sql(
        `select count(*) from public.app_sessions where token_hash='${hash(cookie.value)}' and revoked_at is null and expires_at>clock_timestamp();`,
      ),
      "1",
      "real hashed session missing",
    );
    await safe();
    return cookie;
  };
  const replay = async (cookie, expected = "/login") => {
    await context.clearCookies();
    if (cookie) await context.addCookies([cookie]);
    await goto("/dashboard");
    assert.equal(new URL(page.url()).pathname, expected);
  };
  const cron = async (authorization, query = "") => {
    // Native Node request has no cookie jar/browser session.
    const response = await fetch(
      `${origin}/api/cron/sync-recent-activity${query}`,
      {
        headers: authorization ? { authorization } : {},
        signal: AbortSignal.timeout(175000),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  const sessionState = () =>
    JSON.parse(
      sql(`select jsonb_build_object(
    'count',(select count(*) from public.reading_sessions where id like 'task24-import-%'),
    'distinct',(select count(distinct id) from public.reading_sessions where id like 'task24-import-%'),
    'words',(select coalesce(sum(words_estimated),0) from public.reading_sessions where id like 'task24-import-%'),
    'stream',(select to_jsonb(s) from public.matter_sync_streams s where stream='recent_sessions'),
    'history',(select history_status from public.matter_sync_continuation),
    'receipt',(select count(*) from public.matter_page_receipts where stream='recent_sessions'),
    'dirty',(select count(*) from public.matter_dirty_rollups),
    'rollup',(select coalesce(sum(reading_time_seconds),0) from public.daily_stats where date='2025-06-01')
  )::text;`),
    );
  let capturedAction;
  const manual = async (label) => {
    await goto("/settings");
    const next = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        Boolean(request.headers()["next-action"]) &&
        request
          .postData()
          ?.includes(
            label === "Backfill Library"
              ? "backfill_library"
              : label === "Start / Resume Session History"
                ? "backfill_sessions"
                : "recent_activity_manual",
          ),
    );
    await page.getByRole("button", { name: label, exact: true }).click();
    const request = await next;
    capturedAction = {
      body: request.postDataBuffer(),
      headers: {
        "next-action": request.headers()["next-action"],
        "content-type": request.headers()["content-type"],
        origin,
      },
      url: request.url(),
    };
    await page
      .getByRole("button", { name: label, exact: true })
      .waitFor({ timeout: 175000 });
    return text();
  };
  try {
    phases.begin("authentication");
    for (const route of [
      "/dashboard",
      "/activity",
      "/articles",
      "/articles/task24-item-000",
      "/reports",
      "/settings",
      "/authors",
      "/sources",
      "/tags",
      "/year-in-reading",
    ]) {
      await goto(route);
      assert.equal(new URL(page.url()).pathname, "/login");
    }
    const malformed = {
      name: cookieName,
      value: randomBytes(32).toString("hex"),
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    };
    await replay(malformed);
    await replay({ ...malformed, value: "bad" });
    await context.clearCookies();
    await page
      .getByLabel("Access password")
      .fill("incorrect-synthetic-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Invalid password" })
      .waitFor();
    for (let i = 0; i < 5; i++) {
      await page
        .getByLabel("Access password")
        .fill("incorrect-synthetic-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("alert").waitFor();
      // Wait for action settlement, including the form's uncontrolled reset.
      await page.waitForFunction(
        () => document.querySelector('input[name="password"]')?.value === "",
      );
    }
    await page.getByLabel("Access password").fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: /Too many attempts/ })
      .waitFor();
    assert.equal(
      (await context.cookies()).filter((row) => row.name === cookieName).length,
      0,
    );
    assert.ok(
      Number(
        sql(
          "select count(*) from public.app_login_attempts where succeeded=false;",
        ),
      ) >= 1,
    );
    check(
      "auth: protected pages, missing/malformed/unknown cookie, wrong password and persisted limiter",
    );
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "127.24.0.240" });
    state.fault = "record_app_login_attempt";
    await page.getByLabel("Access password").fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: /temporarily unavailable/ })
      .waitFor();
    assert.equal((await context.cookies()).length, 0);
    state.fault = "app_sessions";
    await page.getByLabel("Access password").fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('input[name="password"]')?.value === "",
    );
    await page
      .getByRole("alert")
      .filter({ hasText: /temporarily unavailable/ })
      .waitFor();
    assert.equal((await context.cookies()).length, 0);
    state.fault = null;
    let cookie = await login();
    check(
      "auth: limiter/session storage faults are retryable, valid form creates real opaque hashed Secure/HttpOnly/Lax session",
    );
    sql(
      `update public.app_sessions set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second' where token_hash='${hash(cookie.value)}';`,
    );
    await replay(cookie);
    cookie = await login();
    sql(
      `update public.app_sessions set revoked_at=clock_timestamp() where token_hash='${hash(cookie.value)}';`,
    );
    await replay(cookie);
    cookie = await login();
    state.fault = "app_sessions";
    await goto("/dashboard");
    assert.equal(new URL(page.url()).pathname, "/login");
    state.fault = null;
    await startApp(2);
    await replay(cookie);
    cookie = await login();
    assert.equal(
      sql(
        `select credential_version from public.app_sessions where token_hash='${hash(cookie.value)}';`,
      ),
      "2",
    );
    check(
      "auth: expired/revoked/storage-unavailable/version-invalidated sessions fail closed; isolated version 2 login recovers",
    );
    phases.end();

    phases.begin("analytics-csv");
    sql(seedSql);
    const rawReference = JSON.parse(
      sql(
        `select jsonb_build_object('sessions',count(*),'seconds',sum(duration_seconds),'unlinked',count(*) filter(where item_id is null))::text from public.reading_sessions;`,
      ),
    );
    assert.deepEqual(rawReference, {
      sessions: sessions.length,
      seconds: sessions.reduce((n, r) => n + r.seconds, 0),
      unlinked: sessions.length,
    });
    const exportRows = async (first, last, expectedName) => {
      const promise = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export CSV", exact: true })
        .click();
      const download = await promise;
      assert.equal(download.suggestedFilename(), expectedName);
      const lines = (await readFile(await download.path(), "utf8")).split("\n");
      assert.equal(
        lines.shift(),
        "date,reading_time_seconds,estimated_words,sessions",
      );
      const actual = lines.map((line) => {
        const [day, ...values] = line.split(",");
        return [day, ...values.map(Number)];
      });
      assert.deepEqual(actual, expectedRows(first, last));
      return actual.reduce(
        (total, row) => row.slice(1).map((value, i) => total[i] + value),
        [0, 0, 0],
      );
    };
    for (const [period, date, first, last, totals] of [
      ["daily", "2025-01-02", "2025-01-02", "2025-01-02", [180, 675, 3]],
      ["weekly", "2025-01-01", "2024-12-30", "2025-01-05", [301, 1129, 6]],
      ["weekly", "2025-03-01", "2025-02-24", "2025-03-02", [62, 233, 2]],
      ["weekly", "2024-03-01", "2024-02-26", "2024-03-03", [60, 225, 1]],
      ["daily", "2025-03-30", "2025-03-30", "2025-03-30", [2, 8, 2]],
      ["daily", "2025-10-26", "2025-10-26", "2025-10-26", [2, 8, 2]],
      ["daily", "2025-12-31", "2025-12-31", "2025-12-31", [1, 4, 1]],
      ["daily", "2026-01-01", "2026-01-01", "2026-01-01", [1, 4, 1]],
      ["daily", "2025-01-04", "2025-01-04", "2025-01-04", [0, 0, 1]],
      ["daily", "2025-01-05", "2025-01-05", "2025-01-05", [0, 0, 0]],
    ]) {
      await goto(`/reports?period=${period}&date=${date}`);
      const reference = period === "weekly" ? first : date;
      assert.deepEqual(
        await exportRows(
          first,
          last,
          `matter-stats-${period}-${reference}.csv`,
        ),
        totals,
      );
      check(`CSV ${period} ${date}`, {
        expected: totals,
        first,
        last,
        independentRowsReconciled: true,
      });
    }
    await goto("/dashboard?start=2025-01-02&end=2025-01-02");
    assert.match(await text(), /675/);
    assert.match(await text(), /3 min/);
    assert.doesNotMatch(await text(), /999,999 estimated words/);
    await capture("overview-desktop");
    for (const [source, label, period, selected, first, last] of [
      [
        "/reports?period=yearly&date=2025",
        "Week",
        "weekly",
        "2025-01-01",
        "2024-12-30",
        "2025-01-05",
      ],
      [
        "/reports?period=monthly&date=2025-03",
        "Week",
        "weekly",
        "2025-03-01",
        "2025-02-24",
        "2025-03-02",
      ],
    ]) {
      await goto(source + "&context=keep");
      await page.getByRole("button", { name: label, exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.waitForURL((url) => url.searchParams.get("period") === period);
      assert.equal(
        await page.getByLabel("Specific report period").inputValue(),
        selected,
      );
      assert.match(await text(), new RegExp(`${first} – ${last}`));
      assert.equal(new URL(page.url()).searchParams.get("context"), "keep");
      await exportRows(first, last, `matter-stats-weekly-${first}.csv`);
      await page.reload();
      assert.equal(
        await page.getByLabel("Specific report period").inputValue(),
        selected,
      );
      await page.goBack();
      await page.goForward();
      assert.equal(
        await page.getByLabel("Specific report period").inputValue(),
        selected,
      );
    }
    await capture("reports-cross-month-desktop");
    check(
      "Reports PR85 successful cross-year/week and cross-month references survive frequency/history/reload with real CSV",
    );
    phases.end();

    phases.begin("navigation-library");
    await goto("/activity?month=2025-04&day=2025-04-01&context=keep");
    const daily = page.getByRole("region", { name: "Selected day" });
    assert.match(await daily.innerText(), /≈100 estimated words · 25 sessions/);
    assert.equal(await daily.locator("article").count(), 20);
    assert.equal(
      await page
        .locator('[aria-label="Monthly reading calendar"] span')
        .first()
        .innerText(),
      "Mon",
    );
    await page.getByRole("link", { name: "Next", exact: true }).click();
    await page.waitForURL("**page=2**");
    assert.equal(await daily.locator("article").count(), 5);
    assert.match(await daily.innerText(), /≈100 estimated words · 25 sessions/);
    assert.equal(new URL(page.url()).searchParams.get("context"), "keep");
    await goto("/activity?month=2025-01&day=2025-01-02");
    assert.match(await text(), /00:00/);
    check(
      "Activity Monday-first calendar, Athens midnight, complete daily totals across 20+5 pagination",
      { expectedSeconds: 25, expectedWords: 100 },
    );
    await goto("/articles");
    assert.equal(await page.getByRole("row").count(), 101);
    const titles = await page
      .getByRole("link", { name: /^Open / })
      .allTextContents();
    assert.match(titles[0], /Untitled article/);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.waitForURL("**page=2**");
    assert.equal(await page.getByRole("row").count(), 6);
    assert.match(await text(), /Synthetic article 104/);
    await goto(
      "/articles?q=Synthetic&source=Synthetic+journal&tag=task24-tag&status=queue&author=Sample+author&type=article",
    );
    assert.match(await text(), /Matching articles\s+1/);
    assert.match(await text(), /Synthetic article 001/);
    const detail = page.getByRole("link", {
      name: "Open Synthetic article 001",
      exact: true,
    });
    await detail.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL("**/articles/task24-item-001");
    assert.match(await text(), /Reading sessions are not attributed/);
    await goto("/articles/task24-item-000");
    assert.match(await text(), /Unknown|Unavailable|Not available|—/);
    await goto("/articles/task24-item-002");
    assert.match(await text(), /0/);
    check(
      "Library 105 real metadata rows: stable 100+5 ordering, combined filters, keyboard detail, null versus known zero; metadata excluded from reading estimates",
    );
    for (const route of ["/authors", "/sources", "/tags"]) {
      await goto(route);
      assert.match(await text(), /attribution is unavailable/);
      assert.doesNotMatch(await text(), /Sync Matter items with tags/);
    }
    await goto("/year-in-reading?year=2025");
    assert.match(await text(), /2025/);
    assert.match(await text(), /sessions/);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of [
      "/dashboard?start=2025-01-02&end=2025-01-02",
      "/activity?month=2025-04&day=2025-04-01",
      "/articles",
      "/reports?period=daily&date=2025-01-02",
      "/settings",
    ]) {
      await goto(route);
      await safe();
      const controls = page
        .locator("main")
        .locator("a:visible,button:visible,input:visible,select:visible");
      const last = controls.last();
      await last.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const rect = await last.boundingBox(),
        bottom = await page.locator(".fixed.bottom-0:visible").boundingBox();
      assert.ok(
        rect && rect.y >= 0 && rect.y + rect.height <= (bottom?.y ?? 844),
        "final control unreachable",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      if (route.startsWith("/activity"))
        await capture("activity-mobile-final-control");
    }
    const summary = page.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent.trim()),
      "Settings",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent.trim()),
      "Log out",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await summary.evaluate((el) => el === document.activeElement),
      true,
    );
    await goto("/reports?period=daily&date=2025-01-02");
    await capture("reports-mobile-three-sessions");
    check(
      "primary and secondary routes; real mobile/desktop renders, keyboard account navigation and reachable final controls",
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    phases.end();

    phases.begin("sync-continuation");
    const initial = sql("select count(*) from public.sync_runs;"),
      upstreamBefore = observations.matter.length;
    for (const [authorization, query] of [
      [null, ""],
      ["Bearer wrong", ""],
      [null, `?secret=${credentials.cron}`],
    ]) {
      assert.equal((await cron(authorization, query)).status, 401);
    }
    assert.equal(sql("select count(*) from public.sync_runs;"), initial);
    assert.equal(observations.matter.length, upstreamBefore);
    sql(
      "update public.matter_sync_streams set transition_status='native' where cycle_generation=0 and completed_watermark is null;",
    );
    for (const route of ["/dashboard", "/settings"]) {
      await goto(route);
      assert.match(
        await text(),
        /No completed sessions synchronization yet|Never completed/,
      );
    }
    check(
      "never-completed status from synthetic fresh native stream state on Overview and Settings",
    );
    state.hold = true;
    let releaseObserved;
    const observed = new Promise((resolve) => {
      releaseObserved = resolve;
    });
    state.onMatter = (request) => {
      if (request.path.endsWith("/reading_sessions")) releaseObserved();
    };
    const pendingManual = manual("Sync Recent Activity");
    await observed;
    const competitor = await cron(`Bearer ${credentials.cron}`);
    assert.equal(competitor.body.status, "skipped");
    assert.equal(competitor.body.skipped_reason, "busy");
    const manualText = await pendingManual;
    state.onMatter = null;
    state.hold = false;
    assert.match(manualText, /budget reached|pending continuation/i);
    let persisted = sessionState();
    assert.equal(persisted.count, 8);
    assert.equal(persisted.receipt, 1);
    assert.ok(persisted.stream.cycle_active);
    assert.equal(persisted.dirty, 0);
    assert.equal(persisted.rollup, 480);
    const checkpoint = persisted.stream.cursor;
    await capture("settings-partial-desktop");
    // Both middleware and the action use real DB authorization. Deterministically
    // revoke AFTER the first (middleware) read, BEFORE the independent action
    // guard's read. A navigation redirect cannot satisfy this assertion.
    const actionCookie = (await context.cookies()).find(
      (row) => row.name === cookieName,
    );
    state.authReadControl = {
      reads: 0,
      onSecond: () =>
        sql(
          `update public.app_sessions set revoked_at=clock_timestamp() where token_hash='${hash(actionCookie.value)}';`,
        ),
    };
    const unauthorized = await context.request.post(capturedAction.url, {
      data: capturedAction.body,
      headers: capturedAction.headers,
    });
    assert.match(await unauthorized.text(), /Your session expired/);
    assert.equal(
      state.authReadControl.reads,
      2,
      "both authorization reads must execute",
    );
    state.authReadControl = null;
    assert.equal(sessionState().count, 8);
    assert.equal(sessionState().stream.cursor, checkpoint);
    await login();
    await startApp(2);
    const scheduled = await cron(`Bearer ${credentials.cron}`);
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.body.status, "partial");
    assert.equal(scheduled.body.pages_committed, 8);
    persisted = sessionState();
    assert.equal(persisted.count, 16);
    assert.notEqual(persisted.stream.cursor, checkpoint);
    await startApp(2);
    const finalText = await manual("Sync Recent Activity");
    assert.match(finalText, /invocation finished|enumeration/i);
    persisted = sessionState();
    assert.equal(persisted.count, 19);
    assert.equal(persisted.distinct, 19);
    assert.equal(persisted.words, 4275);
    assert.equal(persisted.rollup, 1140);
    assert.equal(persisted.stream.cycle_active, false);
    assert.equal(persisted.dirty, 0);
    assert.deepEqual(
      observations.matter
        .filter((row) => row.path.endsWith("/reading_sessions"))
        .map((row) => row.page),
      Array.from({ length: 19 }, (_, i) => i),
    );
    const libraryText = await manual("Backfill Library");
    assert.match(libraryText, /invocation finished/);
    assert.equal(
      sql(
        "select count(*) from public.matter_items where id='task24-imported-item';",
      ),
      "1",
    );
    const historyText = await manual("Start / Resume Session History");
    assert.match(historyText, /history|enumeration/i);
    assert.ok(["running", "complete"].includes(sessionState().history));
    check(
      "real UI manual → authenticated cron without cookie → manual continuation; two app restarts; 19 ordered pages, no duplicates, receipts/checkpoints/rollups, unchanged eight-page budget",
      { imported: 19, estimatedWords: 4275, persistedSeconds: 1140 },
    );
    check(
      "cron rejects missing/wrong/query-only secrets without work; concurrent route/UI admits one owner; captured protected server action independently rejects unauthorized cookie",
    );
    phases.end();

    phases.begin("sync-faults");
    // Finish any remaining history through the real route, preserving progress.
    for (let i = 0; i < 3 && sessionState().history !== "complete"; i++)
      assert.equal((await cron(`Bearer ${credentials.cron}`)).status, 200);
    assert.equal(sessionState().history, "complete");
    for (const fault of ["429", "timeout", "interrupt"]) {
      state.fault = fault;
      const before = sessionState();
      const outcome = await cron(`Bearer ${credentials.cron}`);
      if (fault === "429")
        assert.ok(outcome.status === 500 || outcome.body.status === "skipped");
      else
        assert.equal(
          outcome.status,
          200,
          "one transient failure must use the unchanged natural retry policy",
        );
      assert.equal(sessionState().count, before.count);
      assert.equal(sessionState().stream.cursor, before.stream.cursor);
      state.fault = null;
      await goto("/settings");
      await safe();
      if (fault === "429")
        assert.match(
          await text(),
          /error|skipped|paused|retry|stopped safely/i,
        );
      // Honor actual persisted retry/cooldown deadlines; never clear quota,
      // progress or cached work. The fixture uses only a short Retry-After.
      const deadlines = JSON.parse(
        sql(
          "select jsonb_build_object('quota',(select not_before from public.matter_quota),'stream',(select max(retry_at) from public.matter_sync_streams),'retry',(public.read_matter_retry_status(clock_timestamp())->>'nextEligibleAt'))::text;",
        ),
      );
      const until = Math.max(
        Date.now(),
        ...Object.values(deadlines).filter(Boolean).map(Date.parse),
      );
      assert.ok(
        until - Date.now() < 65000,
        "fixture retry exceeded bounded wait",
      );
      if (until > Date.now())
        await new Promise((resolve) =>
          setTimeout(resolve, until - Date.now() + 50),
        );
      await startApp(2);
      const recovered = await cron(`Bearer ${credentials.cron}`);
      assert.equal(recovered.status, 200);
      assert.notEqual(recovered.body.status, "error");
      assert.equal(sessionState().count, 19);
      check(
        `route fault ${fault}: retained checkpoint and rows, truthful persisted outcome, eligible recovery after restart`,
      );
    }
    state.dropAfter = true;
    const lost = await cron(`Bearer ${credentials.cron}`);
    assert.equal(lost.status, 200);
    assert.equal(state.dropAfter, false);
    assert.equal(sessionState().count, 19);
    check(
      "interrupted persisted page response reconciles by real receipt without duplicate sessions",
    );
    phases.end();

    phases.begin("truthful-status");
    await goto("/settings");
    await safe();
    assert.match(await text(), /Coverage unverified|Unverified/);
    assert.match(await text(), /not guaranteed to resolve attribution/);
    assert.match(await text(), /legacy \/ unverified/);
    // Supplementary SQL state demonstrations are explicitly distinguished from
    // states produced above by the actual route/UI runtime.
    sql(
      "update public.matter_cycle_completions set completed_at=clock_timestamp()-interval '48 hours' where stream='recent_sessions';",
    );
    for (const route of ["/dashboard", "/settings"]) {
      await goto(route);
      assert.match(await text(), /completion is stale/);
    }
    sql(
      "delete from public.matter_cycle_completions where stream='library_items'; update public.matter_sync_streams set completed_watermark=null where stream='library_items';",
    );
    await goto("/settings");
    assert.match(
      await text(),
      /Last completed metadata cycle[\s\S]*Never completed/,
    );
    sql(
      "insert into public.matter_dirty_rollups(date,revision,timezone) values('2025-01-02',gen_random_uuid(),'Europe/Athens') on conflict(date) do nothing;",
    );
    await goto("/settings");
    assert.match(await text(), /pending dirty rollups/);
    check(
      "persisted stale completion, incomplete metadata and dirty-rollup state demonstrations (supplementary SQL fixtures)",
    );
    for (const [fault, pattern] of [
      ["metrics", /Reading data unavailable/],
      ["matter_items", /Library query unavailable/],
      ["matter_cycle_completions", /Sessions status unavailable/],
    ]) {
      state.fault = fault;
      await goto("/dashboard");
      assert.match(await text(), pattern);
      assert.equal(
        await page
          .getByRole("button", { name: "Month", exact: true })
          .isEnabled(),
        true,
      );
      if (fault === "metrics") assert.match(await text(), /Synthetic article/);
      else assert.match(await text(), /Estimated words/);
      await safe();
      if (fault === "metrics")
        await capture("overview-independent-outage-desktop");
      state.fault = null;
    }
    await goto("/reports?period=daily&date=2025-01-05");
    assert.match(await text(), /0/);
    assert.doesNotMatch(await text(), /unavailable/i);
    state.fault = "metrics";
    await goto("/reports?period=daily&date=2025-01-05");
    assert.match(await text(), /Reading report unavailable/);
    state.fault = null;
    check(
      "independent metrics/library/status transport outages keep real remaining reads; failed query differs from successful empty; safe content",
    );
    const candidate = randomUUID(),
      owner = randomUUID();
    sql(
      `select public.repair_prepare('${candidate}','${owner}',null,0,'Europe/Athens');`,
    );
    for (const route of ["/dashboard", "/settings"]) {
      await goto(route);
      assert.match(await text(), /not applied|Updates pending/);
      await safe();
    }
    check(
      "unapplied generation candidate: real isolated repair_prepare state; never described as analytics-ready",
    );
    phases.end();

    phases.begin("logout-replay");
    await goto("/settings");
    const preLogout = (await context.cookies()).find(
      (row) => row.name === cookieName,
    );
    await page
      .locator("aside")
      .getByRole("button", { name: "Log out", exact: true })
      .click();
    await page.waitForURL("**/login");
    assert.equal(
      (await context.cookies()).some((row) => row.name === cookieName),
      false,
    );
    assert.equal(
      sql(
        `select count(*) from public.app_sessions where token_hash='${hash(preLogout.value)}' and revoked_at is not null;`,
      ),
      "1",
    );
    await replay(preLogout);
    check(
      "logout actual form revokes real DB session, deletes Secure cookie and rejects captured pre-logout replay",
    );
    phases.end();
    assert.equal(browserEvents.pageErrors, 0);
    assert.equal(browserEvents.unexpectedRequests, 0);
    assert.ok(
      browserEvents.consoleErrors.every((row) => row.kind === "resource"),
    );
    assert.ok(
      browserEvents.failedResources.every((row) => row.path === "/favicon.ico"),
    );
    save("browser", browserEvents);
    save("journeys", {
      status: "passed",
      checks,
      counts: { passed: checks.length, failed: 0, skipped: 0, todo: 0 },
      screenshots,
      applicationTests: "separate CI verify job",
      databasePhases:
        "separate outcomes.json; groups, not individual assertions",
    });
  } catch (error) {
    save("journeys", {
      status: "failed",
      checks,
      counts: { passed: checks.length, failed: 1, skipped: 0, todo: 0 },
      failedGroup: "see outcomes.json",
      screenshots,
    });
    throw error;
  } finally {
    save("browser", browserEvents);
    await context.close();
  }
}
