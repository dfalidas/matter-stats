import assert from "node:assert/strict";
import { expect } from "playwright/test";
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
  startApp: restartApplication,
  output,
  phases,
  save,
  secrets,
  databasePhases,
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
    locale: "en-US",
    reducedMotion: "reduce",
    acceptDownloads: true,
    serviceWorkers: "block",
    hasTouch: true,
  });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(20000);
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    browserEvents.unexpectedRequests++;
    return route.abort();
  });
  await context.routeWebSocket("**/*", (socket) => {
    browserEvents.unexpectedRequests++;
    socket.close();
  });
  const page = await context.newPage();
  // A process restart is deliberate, but an unrelated browser prefetch racing
  // shutdown is not part of that fault scenario. Drain existing requests, then
  // hold new browser traffic until the recreated production server is ready.
  const startApp = async (version) => {
    await page.waitForLoadState("networkidle");
    let release;
    const ready = new Promise((resolve) => { release = resolve; });
    const hold = async (route) => { await ready; await route.fallback(); };
    await context.route("**/*", hold);
    try {
      await restartApplication(version);
    } finally {
      release();
      await context.unroute("**/*", hold);
    }
  };
  page.on("pageerror", () => browserEvents.pageErrors++);
  page.on("console", (message) => {
    if (message.type() === "error")
      browserEvents.consoleErrors.push({
        kind: message.text().startsWith("Failed to load resource")
          ? "resource"
          : "other",
        classification: message.text().startsWith("Failed to fetch RSC payload")
          ? "rsc-fetch-failure"
          : message.text().startsWith("Failed to load resource")
            ? "resource-load-failure" : "unclassified",
        route: new URL(page.url()).pathname,
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
  const loginAlert = page.locator("main").getByRole("alert");
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
  const submitLogin = async (redirects = false) => {
    const responded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/login" &&
        response.request().method() === "POST" &&
        Boolean(response.request().headers()["next-action"]),
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await responded;
    if (!redirects) {
      await page
        .getByRole("button", { name: "Sign in", exact: true })
        .waitFor();
      await page.waitForFunction(
        () => document.querySelector('input[name="password"]')?.value === "",
      );
    }
  };
  let clientIdentity = 0;
  const login = async () => {
    await context.clearCookies();
    await context.setExtraHTTPHeaders({
      "x-forwarded-for": `127.24.0.${++clientIdentity}`,
    });
    await goto("/login");
    await page.getByLabel("Access password").fill(credentials.password);
    await submitLogin(true);
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
    'unlinked',(select count(*) from public.reading_sessions where id like 'task24-import-%' and item_id is null),
    'words',(select coalesce(sum(words_estimated),0) from public.reading_sessions where id like 'task24-import-%'),
    'stream',(select to_jsonb(s) from public.matter_sync_streams s where stream='recent_sessions'),
    'history',(select history_status from public.matter_sync_continuation),
    'receipt',(select count(*) from public.matter_page_receipts where stream='recent_sessions'),
    'dirty',(select count(*) from public.matter_dirty_rollups),
    'rollup',(select coalesce(sum(reading_time_seconds),0) from public.daily_stats where date='${state.importDay}')
  )::text;`),
    );
  let capturedAction;
  const manual = async (label) => {
    await goto("/settings");
    if (label === "Sync Recent Activity")
      await page.getByLabel("Recent activity window").selectOption("all");
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
    const responded = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        Boolean(response.request().headers()["next-action"]) &&
        response
          .request()
          .postData()
          ?.includes(
            label === "Backfill Library"
              ? "backfill_library"
              : label === "Start / Resume Session History"
                ? "backfill_sessions"
                : "recent_activity_manual",
          ),
      { timeout: 175000 },
    );
    await page.getByRole("button", { name: label, exact: true }).click();
    const request = await next;
    assert.equal(new URL(request.url()).origin, origin);
    capturedAction = {
      body: request.postDataBuffer(),
      headers: {
        "next-action": request.headers()["next-action"],
        "content-type": request.headers()["content-type"],
        origin,
      },
      url: request.url(),
    };
    await responded;
    await page
      .getByRole("button", { name: label, exact: true })
      .waitFor({ timeout: 175000 });
    return text();
  };
  try {
    phases.begin("authentication");
    databasePhases.begin("sessions");
    for (const route of [
      "/",
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
    await submitLogin();
    await loginAlert.filter({ hasText: "Invalid password" }).waitFor();
    for (let i = 0; i < 5; i++) {
      await page
        .getByLabel("Access password")
        .fill("incorrect-synthetic-password");
      await submitLogin();
      await loginAlert.waitFor();
    }
    await page.getByLabel("Access password").fill(credentials.password);
    await submitLogin();
    await loginAlert.filter({ hasText: /Too many attempts/ }).waitFor();
    assert.equal(
      (await context.cookies()).filter((row) => row.name === cookieName).length,
      0,
    );
    assert.ok(
      Number(
        sql(
          "select count(*) from public.app_login_attempts where succeeded=false;",
        ),
      ) === 5,
    );
    check(
      "auth: protected pages, missing/malformed/unknown cookie, wrong password and persisted limiter",
    );
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "127.24.0.240" });
    state.fault = "record_app_login_attempt";
    await page.getByLabel("Access password").fill(credentials.password);
    await submitLogin();
    await loginAlert.filter({ hasText: /temporarily unavailable/ }).waitFor();
    assert.equal((await context.cookies()).length, 0);
    state.fault = "app_sessions";
    await page.getByLabel("Access password").fill(credentials.password);
    await submitLogin();
    await loginAlert.filter({ hasText: /temporarily unavailable/ }).waitFor();
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
    databasePhases.end();
    phases.end();

    phases.begin("analytics-csv");
    databasePhases.begin("analytics-reference");
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
    // Task 27: real schema rejects impossible stored inputs; nullable fields
    // remain representable and are reported separately from dated analytics.
    sql(`do $$ begin
      begin
        insert into public.reading_sessions(id,duration_seconds) values ('task27-negative',-1);
        raise exception 'negative accepted';
      exception when check_violation then null; end;
      begin
        insert into public.reading_sessions(id) select id from public.reading_sessions limit 1;
        raise exception 'duplicate accepted';
      exception when unique_violation then null; end;
      insert into public.reading_sessions(id,started_at,duration_seconds) values ('task27-null',null,null);
      if not exists(select 1 from public.reading_sessions where id='task27-null' and started_at is null and duration_seconds is null) then raise exception 'nullable contract'; end if;
      delete from public.reading_sessions where id='task27-null';
    end $$;`);
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
      ["monthly", "2025-01", "2025-01-01", "2025-01-31", [420, 1575, 6]],
      ["yearly", "2025", "2025-01-01", "2025-12-31", [514, 1936, 40]],
      ["weekly", "2025-01-01", "2024-12-30", "2025-01-05", [301, 1129, 6]],
      ["weekly", "2025-03-01", "2025-02-24", "2025-03-02", [62, 233, 2]],
      ["weekly", "2024-03-01", "2024-02-26", "2024-03-03", [60, 225, 1]],
      ["daily", "2025-03-30", "2025-03-30", "2025-03-30", [2, 8, 2]],
      ["daily", "2025-10-26", "2025-10-26", "2025-10-26", [2, 8, 2]],
      ["daily", "2025-12-31", "2025-12-31", "2025-12-31", [1, 4, 1]],
      ["daily", "2026-01-01", "2026-01-01", "2026-01-01", [1, 4, 1]],
      ["daily", "2025-01-04", "2025-01-04", "2025-01-04", [0, 0, 1]],
      ["daily", "2025-04-01", "2025-04-01", "2025-04-01", [25, 100, 25]],
      ["daily", "2025-01-05", "2025-01-05", "2025-01-05", [0, 0, 0]],
    ]) {
      await goto(`/reports?period=${period}&date=${date}`);
      const reference = period === "weekly" ? first : date;
      const rawPeriod = JSON.parse(sql(`select jsonb_build_array(
        coalesce(sum(duration_seconds),0),
        coalesce(sum(round(duration_seconds::numeric / 60 * 225)),0), count(*),
        count(distinct (started_at at time zone 'Europe/Athens')::date) filter(where duration_seconds > 0)
      )::text from public.reading_sessions where started_at >= '${first}'::date::timestamp at time zone 'Europe/Athens'
        and started_at < ('${last}'::date + 1)::timestamp at time zone 'Europe/Athens';`));
      assert.deepEqual(rawPeriod.slice(0,3), totals);
      assert.equal(rawPeriod[3], expectedRows(first,last).filter(r=>r[1]>0).length);
      assert.deepEqual(
        await exportRows(
          first,
          last,
          `matter-stats-${period}-${reference}.csv`,
        ),
        totals,
      );
      if (["monthly", "yearly"].includes(period)) {
        const verifyCards = async () => {
          for (const [label, value] of [["Sessions", String(totals[2])], ["Active days", String(rawPeriod[3])], ["Estimated words", `≈${totals[1].toLocaleString("en-US")}`]]) {
            await expect(page.getByText(label, { exact: true }).locator("..").getByText(value, { exact: true })).toBeVisible();
          }
        };
        await verifyCards();
        await goto(`/dashboard?start=${first}&end=${last}`);
        await verifyCards();
      }
      check(`CSV ${period} ${date}`, {
        expected: totals,
        first,
        last,
        independentRowsReconciled: true,
        timezone: "Europe/Athens", filters: "[local start, next local midnight); all linkage states",
        source: "raw SQL / downloaded Reports CSV", actual: rawPeriod.slice(0,3), difference: [0,0,0], activeDays: rawPeriod[3],
      });
    }
    // Task 30: actual Reports UI, synthetic SQL only, same owned isolated stack.
    assert.equal(sql("select count(*) from public.matter_dirty_rollups where date between '2026-08-01' and '2026-09-30';"), "0", "monthly fixture dates must have no pre-existing dirty markers");
    const reportControlBefore = sql("select jsonb_build_object('streams',(select jsonb_agg(jsonb_build_object('stream',stream,'active',cycle_active)) from public.matter_sync_streams),'history',(select history_status from public.matter_sync_continuation where account_scope='matter'))::text;");
    const reportControl = JSON.parse(reportControlBefore);
    const restoreReportHistory = sql("select format('update public.matter_sync_continuation set history_status=%L,requested_at=%L,history_cycle_generation=%L,completed_at=%L where account_scope=''matter'';',history_status,requested_at,history_cycle_generation,completed_at) from public.matter_sync_continuation where account_scope='matter';");
    sql("update public.matter_sync_streams set cycle_active=false; update public.matter_sync_continuation set history_status='complete',requested_at='2026-01-01T00:00:00Z',history_cycle_generation=1,completed_at='2026-01-01T00:00:00Z' where account_scope='matter';");
    sql(`insert into public.reading_sessions(id,started_at,duration_seconds) select 'task30-sep-' || i, ('2026-09-01T10:00:00Z'::timestamptz + ((i-1)%18)*interval '1 day'),720 from generate_series(1,60) i;
      insert into public.reading_sessions(id,started_at,duration_seconds) select 'task30-aug-' || i, ('2026-08-01T10:00:00Z'::timestamptz + ((i-1)%15)*interval '1 day'),750 from generate_series(1,48) i;`);
    await goto("/reports?period=monthly&date=2026-09&context=keep");
    const observationsPanel = page.getByRole("region", {name:"Monthly observations"});
    await expect(page.getByText("Time per active day: 40 min", {exact:true})).toBeVisible();
    await expect(observationsPanel).toContainText("Imported reading time increased by 2h (20%).");
    await expect(observationsPanel).toContainText("More active days (18 vs 15), shorter average sessions (12.0 min vs 12.5 min).");
    await expect(page.getByText("Minutes per day · Daily resolution", {exact:true})).toBeVisible();
    await page.getByRole("button", {name:"Weekly",exact:true}).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Minutes per week · Weekly resolution (Monday first)",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Daily",exact:true}).press("Enter");
    await page.getByText("Daily values (all local dates)",{exact:true}).click();
    const dailyTable = page.getByRole("table",{name:"Canonical daily reading time in seconds"});
    await expect(dailyTable.getByRole("row")).toHaveCount(31);
    await expect(dailyTable.getByRole("row").last()).toContainText("2026-09-30");
    await expect(dailyTable.getByRole("row").last()).toContainText("0");
    const monthlyDownloadEvent = page.waitForEvent("download");
    await page.getByRole("button",{name:"Export CSV",exact:true}).click();
    const monthlyDownload=await monthlyDownloadEvent;
    assert.equal(monthlyDownload.suggestedFilename(),"matter-stats-monthly-2026-09.csv");
    const monthlyCsv=(await readFile(await monthlyDownload.path(),"utf8")).trim().split("\n");
    assert.equal(monthlyCsv[0],"date,reading_time_seconds,estimated_words,sessions");
    assert.equal(monthlyCsv.length,31);
    assert.deepEqual(monthlyCsv.slice(1).reduce((sum,line)=>line.split(",").slice(1).map((value,index)=>sum[index]+Number(value)),[0,0,0]),[43200,162000,60]);
    check("Monthly review: approved totals, two observations, keyboard resolution, all zero dates and unchanged exact CSV");
    await page.getByRole("link",{name:"Open 2026-08 monthly report",exact:true}).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Specific report period")).toHaveValue("2026-08");
    assert.equal(new URL(page.url()).searchParams.get("context"),"keep");
    await expect(page.locator("main")).toContainText("Previous month: 2026-07-01 – 2026-07-31");
    await page.getByRole("link",{name:"Open 2026-01 monthly report",exact:true}).click();
    await expect(page.getByLabel("Specific report period")).toHaveValue("2026-01");
    await expect(page.locator("main")).toContainText("Previous month: 2025-12-01 – 2025-12-31");
    await page.getByLabel("Specific report period").fill("2024-02");
    await page.getByRole("button",{name:"Apply period",exact:true}).click();
    await expect(page.getByLabel("Specific report period")).toHaveValue("2024-02");
    await expect(page.getByRole("link",{name:"Open 2024-12 monthly report",exact:true})).toBeVisible();
    await expect(page.getByRole("link",{name:"Explore your 2024 annual recap →",exact:true})).toHaveAttribute("href","/year-in-reading?year=2024");
    await goto("/reports?period=monthly&date=2024-01");
    await expect(page.getByText("— / No active days",{exact:false})).toBeVisible();
    await expect(page.getByRole("region",{name:"Monthly observations"})).toContainText("No change (0 in both)");
    check("Monthly review: trend month/year identity, retained context, January previous December, selected-year recap and empty zero states");
    const localMonth = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit"}).formatToParts(new Date());
    const selectedYear=localMonth.find(part=>part.type==="year").value;
    const currentMonth=`${selectedYear}-${localMonth.find(part=>part.type==="month").value}`;
    const futureMonth=`${Number(selectedYear)+1}-01`;
    for(const [month,label] of [[currentMonth,"In progress"],[futureMonth,"Not started"]]) {
      await goto(`/reports?period=monthly&date=${month}`);
      await expect(page.locator("main")).toContainText(label);
      await expect(page.getByRole("region",{name:"Monthly observations"})).toHaveCount(0);
    }
    sql("update public.matter_sync_continuation set history_status='pending',requested_at='2026-01-01T00:00:00Z',history_cycle_generation=null,completed_at=null where account_scope='matter';");
    await goto("/reports?period=monthly&date=2026-09");
    await expect(page.getByText("Review is provisional; import is incomplete.",{exact:true})).toBeVisible();
    await expect(page.getByRole("region",{name:"Monthly observations"})).toHaveCount(0);
    sql("update public.matter_sync_continuation set history_status='complete',requested_at='2026-01-01T00:00:00Z',history_cycle_generation=1,completed_at='2026-01-01T00:00:00Z' where account_scope='matter';");
    for(const [fault,label] of [["report-previous","Comparison unavailable."],["report-trend","Monthly trend unavailable."],["matter_sync_streams","Import status unavailable; performance comparisons are unavailable."],["metrics","Reading report unavailable."]]) {
      state.fault=fault;
      await goto("/reports?period=monthly&date=2026-09");
      await expect(page.locator("main")).toContainText(label);
      if(fault !== "metrics") await expect(page.getByText("Time per active day: 40 min",{exact:true})).toBeVisible();
      if(fault !== "report-trend") await expect(page.getByRole("region",{name:"Monthly observations"})).toHaveCount(0);
    }
    state.fault=null;
    check("Monthly review: current/future suppress claims; incomplete import and separate current/previous/trend/status read failures are truthful");
    await goto("/reports?period=monthly&date=2026-09");
    for(const width of [390,1440]) {
      await page.setViewportSize({width,height:1000});
      for(const colorScheme of ["light","dark"]) {
        await page.emulateMedia({colorScheme});
        await page.evaluate(dark=>document.documentElement.classList.toggle("dark",dark),colorScheme === "dark");
        await page.getByRole("heading",{name:"Your monthly review",exact:true}).evaluate(element => element.scrollIntoView({block:"start"}));
        await capture(`monthly-${width}-${colorScheme}`);
        await page.getByRole("heading",{name:"Reading over time",exact:true}).scrollIntoViewIfNeeded();
        await expect(page.getByText("Minutes per day · Daily resolution",{exact:true})).toBeVisible();
        await capture(`monthly-charts-${width}-${colorScheme}`);
      }
    }
    await page.evaluate(()=>document.documentElement.classList.remove("dark"));
    await page.emulateMedia({colorScheme:"light"});
    await page.setViewportSize({width:1440,height:1000});
    sql("delete from public.reading_sessions where id like 'task30-%';");
    // Raw fixture deletion dirties its dates too. Restore only the proven-empty
    // owned date range so later ingestion journeys keep their original input.
    sql("delete from public.matter_dirty_rollups where date between '2026-08-01' and '2026-09-30';");
    for(const stream of reportControl.streams) sql(`update public.matter_sync_streams set cycle_active=${stream.active} where stream='${stream.stream}';`);
    sql(restoreReportHistory);
    check("Monthly review: desktop/mobile light/dark screenshots, keyboard controls and no horizontal overflow");
    await goto("/dashboard?start=2025-01-02&end=2025-01-02");
    assert.match(await text(), /675/);
    assert.match(await text(), /3 min/);
    assert.doesNotMatch(await text(), /999,999 estimated words/);
    await capture("overview-desktop");
    for (const [source, label, period, selected, first, last, sourceFirst, sourceLast] of [
      [
        "/reports?period=yearly&date=2025",
        "Week",
        "weekly",
        "2025-01-01",
        "2024-12-30",
        "2025-01-05",
        "2025-01-01",
        "2025-12-31",
      ],
      [
        "/reports?period=monthly&date=2025-03",
        "Week",
        "weekly",
        "2025-03-01",
        "2025-02-24",
        "2025-03-02",
        "2025-03-01",
        "2025-03-31",
      ],
    ]) {
      const originalUrl = new URL(source + "&context=keep", origin);
      const weeklyUrl = new URL(originalUrl);
      weeklyUrl.searchParams.set("period", period);
      weeklyUrl.searchParams.set("date", selected);
      const originalPeriod = originalUrl.searchParams.get("period");
      const originalDate = originalUrl.searchParams.get("date");
      const assertReport = async (url, value, start, end) => {
        // App Router history can update the URL before React commits the form.
        // Wait independently for the exact URL and rendered selection, bounded
        // by the same action timeout. Never accept either the old or new value.
        await expect(page).toHaveURL(url.href, { timeout: 15000 });
        await expect(page.getByLabel("Specific report period")).toHaveValue(
          value, { timeout: 15000 },
        );
        await expect(page.getByRole("button", {
          name: url.searchParams.get("period") === "weekly" ? "Week"
            : originalPeriod === "yearly" ? "Year" : "Month",
          exact: true,
        })).toHaveAttribute("aria-pressed", "true", { timeout: 15000 });
        await expect(page.getByRole("heading", {
          name: `Your ${url.searchParams.get("period")} review`, exact: true,
        })).toBeVisible({ timeout: 15000 });
        assert.match(await text(), new RegExp(`${start} – ${end}`));
        assert.equal(new URL(page.url()).searchParams.get("context"), "keep");
      };
      await goto(originalUrl.pathname + originalUrl.search);
      await page.getByRole("button", { name: label, exact: true }).focus();
      await page.keyboard.press("Enter");
      await assertReport(weeklyUrl, selected, first, last);
      await exportRows(first, last, `matter-stats-weekly-${first}.csv`);
      await page.reload();
      await assertReport(weeklyUrl, selected, first, last);
      if (source.includes("monthly"))
        await capture("reports-cross-month-desktop");
      await page
        .getByRole("button", {
          name: originalPeriod === "yearly" ? "Year" : "Month",
          exact: true,
        })
        .click();
      await assertReport(originalUrl, originalDate, sourceFirst, sourceLast);
      // Three complete round trips, not retries: every assertion must pass.
      // Only synthetic report values are recorded, never URLs/cookies/records.
      for (let round = 1; round <= 3; round++) {
        for (const direction of ["Back", "Forward"]) {
          await page.evaluate(() => {
            window.__task25HistoryControl = null;
            window.addEventListener("popstate", () => {
              window.__task25HistoryControl = document.querySelector(
                'input[aria-label="Specific report period"]',
              )?.value ?? null;
            }, { once: true });
          });
          if (direction === "Back") await page.goBack();
          else await page.goForward();
          const atReturn = await page.getByLabel("Specific report period").inputValue();
          const atPopstate = await page.evaluate(() => window.__task25HistoryControl);
          const back = direction === "Back";
          await assertReport(back ? weeklyUrl : originalUrl,
            back ? selected : originalDate,
            back ? first : sourceFirst, back ? last : sourceLast);
          check(`Reports ${originalPeriod} history ${direction} round ${round}`, {
            expectedPeriod: back ? period : originalPeriod,
            expectedDate: back ? selected : originalDate,
            controlAtPopstate: atPopstate,
            controlAtNavigationReturn: atReturn,
            renderedSelectionVerified: true,
          });
        }
        await page.reload();
        await assertReport(originalUrl, originalDate, sourceFirst, sourceLast);
      }
    }
    check(
      "Reports PR85 successful cross-year/week and cross-month references survive frequency/history/reload with real CSV",
    );
    await goto("/dashboard?start=2025-01-01&end=2025-01-31");
    const weeklyGoal = page.getByRole("article", { name: "Weekly reading goal" });
    const yearlyGoal = page.getByRole("article", { name: "Yearly reading goal" });
    await expect(weeklyGoal).toContainText("No goal set.");
    await expect(yearlyGoal).toContainText("No goal set.");
    let capturedGoalAction;
    const createGoal = async (card, label, value) => {
      await card.getByRole("button", { name: "Set goal", exact: true }).click();
      if (label === "Weekly") {
        await card.getByLabel(`${label} target in hours`).fill("0.001");
        await card.getByRole("button", { name: "Save goal", exact: true }).click();
        await expect(card).toContainText("Enter positive hours");
        await card.getByLabel(`${label} target in hours`).fill(value);
        state.fault = "reading_goals";
        await card.getByRole("button", { name: "Save goal", exact: true }).click();
        await expect(card).toContainText("Goal could not be saved");
        await expect(card.getByLabel(`${label} target in hours`)).toHaveValue(value);
        state.fault = null;
      }
      await card.getByLabel(`${label} target in hours`).fill(value);
      const goalRequest = page.waitForRequest(request => request.method() === "POST" && Boolean(request.headers()["next-action"]));
      await card.getByRole("button", { name: "Save goal", exact: true }).click();
      const request = await goalRequest;
      capturedGoalAction = { url: request.url(), body: request.postDataBuffer(), headers: {
        "next-action": request.headers()["next-action"], "content-type": request.headers()["content-type"], origin,
      } };
      await expect(card).toContainText("Goal saved for this period.");
    };
    await createGoal(weeklyGoal, "Weekly", "1.25");
    await createGoal(yearlyGoal, "Yearly", "12.34");
    assert.deepEqual(JSON.parse(sql("select jsonb_agg(jsonb_build_array(type,target_seconds,enabled) order by type)::text from public.reading_goals;")), [["weekly",4500,true],["yearly",44424,true]]);
    await page.reload();
    await expect(weeklyGoal).toContainText("Target 1.25 h");
    await expect(yearlyGoal).toContainText("Target 12.34 h");
    await weeklyGoal.getByRole("button", { name: "Edit goal" }).click();
    await weeklyGoal.getByLabel("Weekly target in hours").fill("2.01");
    await weeklyGoal.getByRole("button", { name: "Save goal", exact: true }).click();
    await expect(weeklyGoal).toContainText("Target 2.01 h");
    await weeklyGoal.getByRole("button", { name: "Disable goal" }).click();
    await expect(weeklyGoal).toContainText("Goal disabled for this period.");
    await page.reload();
    await expect(weeklyGoal).toContainText("Goal disabled for this period.");
    assert.equal(sql("select target_seconds || ':' || enabled from public.reading_goals where type='weekly';").trim(), "7236:false");
    sql("insert into public.reading_goals(type,period_start,target_seconds) values('yearly','2020-01-01',9000);");
    await yearlyGoal.getByRole("button", { name: "Edit goal" }).click();
    await yearlyGoal.getByLabel("Yearly target in hours").fill("20.01");
    await yearlyGoal.getByRole("button", { name: "Save goal", exact: true }).press("Enter");
    await expect(yearlyGoal).toContainText("Target 20.01 h");
    assert.equal(sql("select target_seconds from public.reading_goals where type='yearly' and period_start='2020-01-01';").trim(), "9000");
    state.fault = "metrics";
    await page.reload();
    await expect(yearlyGoal).toContainText("Target 20.01 h");
    await expect(yearlyGoal).toContainText("Reading progress unavailable");
    state.fault = "reading_goals";
    await page.reload();
    await expect(yearlyGoal).toContainText("Goal unavailable");
    await expect(yearlyGoal).not.toContainText("No goal set.");
    state.fault = null;
    await page.reload();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), colorScheme === "dark");
        await expect(yearlyGoal.getByRole("progressbar")).toBeVisible();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.evaluate(() => document.getElementById("reading-goals-title").scrollIntoView({ block: "start" }));
        await capture(`goals-${width}-${colorScheme}`);
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    const goalCookie = (await context.cookies()).find(cookie => cookie.name === cookieName);
    assert.ok(goalCookie);
    const goalRowsBeforeDeniedAction = sql("select jsonb_agg(to_jsonb(g) order by type,period_start)::text from public.reading_goals g;");
    await page.waitForLoadState("networkidle");
    state.authReadControl = { reads: 0, onActionRead: () => sql(`update public.app_sessions set revoked_at=clock_timestamp() where token_hash='${hash(goalCookie.value)}';`) };
    try {
      const deniedGoal = await context.request.post(capturedGoalAction.url, { data: capturedGoalAction.body, headers: capturedGoalAction.headers, maxRedirects: 0 });
      assert.match(deniedGoal.headers()["x-action-redirect"] ?? await deniedGoal.text(), /\/login/);
      assert.ok(state.authReadControl.reads >= 1, "goal action must perform its independent session guard");
      assert.equal(sql("select jsonb_agg(to_jsonb(g) order by type,period_start)::text from public.reading_goals g;"), goalRowsBeforeDeniedAction);
    } finally {
      state.authReadControl = null;
      sql(`update public.app_sessions set revoked_at=null where token_hash='${hash(goalCookie.value)}';`);
    }
    check("Goals: independent server-action guard rejects a revoked session and leaves all persisted goal fields unchanged");
    check("Goals: browser/server/real database create, reload, edit, disable, historical isolation, filter independence and mobile/theme layouts");
    sql("delete from public.reading_goals;");
    databasePhases.end();
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
    await page.waitForFunction(
      () =>
        document
          .querySelector('section[aria-label="Selected day"]')
          ?.querySelectorAll("article").length === 5,
    );
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
    const libraryOrder = await page
      .getByRole("link", { name: /^Open / })
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.waitForURL("**page=2**");
    await page
      .getByRole("link", { name: "Open Synthetic article 104", exact: true })
      .waitFor();
    assert.equal(await page.getByRole("row").count(), 6);
    assert.match(await text(), /Synthetic article 104/);
    libraryOrder.push(
      ...(await page
        .getByRole("link", { name: /^Open / })
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute("href")),
        )),
    );
    assert.deepEqual(
      libraryOrder,
      Array.from(
        { length: 105 },
        (_, i) => `/articles/task24-item-${String(i).padStart(3, "0")}`,
      ),
    );
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
    await page
      .getByText(/Reading sessions are not attributed to this item/)
      .waitFor();
    assert.match(await text(), /Reading sessions are not attributed/);
    await goto("/articles/task24-item-000");
    assert.equal(
      await page
        .getByText("Article size", { exact: true })
        .locator("..")
        .locator("dd")
        .textContent(),
      "Not available",
    );
    await goto("/articles/task24-item-002");
    assert.equal(
      await page
        .getByText("Article size", { exact: true })
        .locator("..")
        .locator("dd")
        .textContent(),
      "≈0 words",
    );
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
      if (route.startsWith("/activity")) {
        await page.getByRole("button", { name: /^2025-04-01,/ }).tap();
        await page.getByRole("link", { name: "Next", exact: true }).tap();
        await page.waitForURL("**page=2**");
        await page.waitForFunction(
          () =>
            document
              .querySelector('section[aria-label="Selected day"]')
              ?.querySelectorAll("article").length === 5,
        );
        assert.equal(
          await page
            .getByRole("region", { name: "Selected day" })
            .locator("article")
            .count(),
          5,
        );
        assert.match(await text(), /≈100 estimated words · 25 sessions/);
      }
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
    databasePhases.begin("ingestion");
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
    let observedTimer;
    try {
      await Promise.race([
        observed,
        pendingManual.then(() => {
          throw new Error(
            "Manual invocation ended before the concurrency gate",
          );
        }),
        new Promise((_, reject) => {
          observedTimer = setTimeout(
            () =>
              reject(new Error("Concurrent invocation coordination timed out")),
            30000,
          );
        }),
      ]);
    } finally {
      clearTimeout(observedTimer);
    }
    const competitor = await cron(`Bearer ${credentials.cron}`);
    assert.equal(competitor.body.status, "skipped");
    assert.equal(competitor.body.skipped_reason, "busy");
    const manualText = await pendingManual;
    state.onMatter = null;
    state.hold = false;
    assert.match(manualText, /pages budget reached/i);
    let persisted = sessionState();
    assert.equal(persisted.count, 8);
    assert.equal(persisted.receipt, 1);
    assert.ok(persisted.stream.cycle_active);
    assert.equal(persisted.dirty, 0);
    assert.equal(persisted.rollup, 480);
    const checkpoint = persisted.stream.cursor;
    assert.ok(typeof checkpoint === "string" && checkpoint.length > 0);
    const cycleGeneration = persisted.stream.cycle_generation;
    await capture("settings-partial-desktop");
    // Middleware's Edge fetch uses real Supabase directly. Its successful read
    // precedes this Node action transport hook. Revoke just before the action's
    // own real lookup; a navigation redirect cannot satisfy the action message.
    const actionCookie = (await context.cookies()).find(
      (row) => row.name === cookieName,
    );
    await page.waitForLoadState("networkidle");
    let releaseBrowser;
    const browserGate = new Promise((resolve) => {
      releaseBrowser = resolve;
    });
    const holdBrowser = async (route) => {
      await browserGate;
      await route.fallback();
    };
    await page.route("**/*", holdBrowser);
    state.authReadControl = {
      reads: 0,
      onActionRead: () =>
        sql(
          `update public.app_sessions set revoked_at=clock_timestamp() where token_hash='${hash(actionCookie.value)}';`,
        ),
    };
    try {
      const unauthorized = await context.request.post(capturedAction.url, {
        data: capturedAction.body,
        headers: capturedAction.headers,
      });
      assert.match(await unauthorized.text(), /Your session expired/);
      assert.ok(
        state.authReadControl.reads >= 1,
        "the independent action guard must execute",
      );
    } finally {
      state.authReadControl = null;
      releaseBrowser();
      await page.unroute("**/*", holdBrowser);
    }
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
    assert.equal(persisted.stream.cycle_generation, cycleGeneration);
    await startApp(2);
    const finalText = await manual("Start / Resume Session History");
    assert.match(finalText, /invocation finished|enumeration/i);
    persisted = sessionState();
    assert.equal(persisted.count, 19);
    assert.equal(persisted.distinct, 19);
    assert.equal(persisted.words, 4275);
    assert.equal(persisted.unlinked, 19);
    assert.equal(persisted.rollup, 1140);
    assert.equal(persisted.stream.cycle_active, false);
    assert.equal(persisted.stream.cycle_generation, cycleGeneration);
    assert.equal(persisted.dirty, 0);
    assert.deepEqual(
      observations.matter
        .filter((row) => row.path.endsWith("/reading_sessions"))
        .map((row) => row.page),
      Array.from({ length: 19 }, (_, i) => i),
    );
    for (const route of [
      `/dashboard?start=${state.importDay}&end=${state.importDay}`,
      "/settings",
    ]) {
      await goto(route);
      assert.match(await text(), /Sessions completion is recent/);
      assert.match(
        await text(),
        /Metadata: Never completed|Last completed metadata cycle[\s\S]*Never completed/,
      );
      if (route.startsWith("/dashboard")) {
        assert.match(await text(), /4,275/);
        assert.match(await text(), /19 min/);
        await capture("overview-synced-desktop");
      }
    }
    check(
      "runtime-completed sessions remain independent of never-completed library metadata",
    );
    const libraryText = await manual("Backfill Library");
    assert.match(libraryText, /invocation finished/);
    assert.equal(
      sql(
        "select count(*) from public.matter_items where id='task24-imported-item';",
      ),
      "1",
    );
    assert.equal(
      sessionState().unlinked,
      19,
      "library metadata does not invent session attribution",
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
    databasePhases.end();
    phases.end();

    phases.begin("sync-faults");
    databasePhases.begin("faults");
    // Finish any remaining history through the real route, preserving progress.
    for (let i = 0; i < 3 && sessionState().history !== "complete"; i++)
      assert.equal((await cron(`Bearer ${credentials.cron}`)).status, 200);
    assert.equal(sessionState().history, "complete");
    for (const fault of ["429", "timeout", "interrupt"]) {
      state.fault = fault;
      const observedBefore = observations.matterFaults[fault];
      const before = sessionState();
      const outcome = await cron(`Bearer ${credentials.cron}`);
      assert.equal(
        observations.matterFaults[fault],
        observedBefore + 1,
        "the deliberate upstream fault must actually execute once",
      );
      if (fault === "429") assert.equal(outcome.status, 500);
      else
        assert.equal(
          outcome.status,
          200,
          "one transient failure must use the unchanged natural retry policy",
        );
      assert.equal(sessionState().count, before.count);
      if (fault === "429")
        assert.equal(sessionState().stream.cursor, before.stream.cursor);
      else
        assert.ok(
          outcome.body.pages_committed > 0 && outcome.body.pages_committed <= 8,
          "successful natural retry may advance its durable contract within the unchanged budget",
        );
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
      assert.ok(["success", "partial"].includes(recovered.body.status));
      assert.ok(recovered.body.pages_committed > 0);
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
    databasePhases.end();
    phases.end();

    phases.begin("truthful-status");
    databasePhases.begin("status");
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
      "insert into public.matter_dirty_rollups(date,revision,timezone) values('2025-01-02',gen_random_uuid(),'Europe/Athens') on conflict(date) do nothing;",
    );
    await goto("/settings");
    assert.match(await text(), /pending dirty rollups/);
    check(
      "persisted stale completion and dirty-rollup state demonstrations (supplementary SQL fixtures); durable progress is never cleared",
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
    const prepared = JSON.parse(sql("select public.read_matter_generation_status()::text;"));
    assert.equal(prepared.frozen, true);
    assert.equal(prepared.candidate.state, "capture_sessions");
    assert.equal(prepared.candidate.reconciled, null);
    for (const route of ["/dashboard", "/settings"]) {
      await goto(route);
      assert.match(
        await text(),
        /not applied|Updates pending|writer barrier frozen/,
      );
      await safe();
    }
    check(
      "unapplied generation candidate: real isolated repair_prepare state; never described as analytics-ready",
      { persistedReconciliation: null, expectedReadiness: "writer barrier frozen" },
    );
    databasePhases.end();
    phases.end();

    phases.begin("logout-replay");
    databasePhases.begin("logout");
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
    databasePhases.end();
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
    phases.end();
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
