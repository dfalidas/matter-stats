import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsQueryContext } from "../lib/analytics-query-context";
import { getReadingMetrics } from "../lib/metrics-service";
import { getOverviewReadingMetrics, toOverviewClientPayload } from "../lib/overview-service";
import { getReadingReport, toReportsClientPayload, toYearInReadingClientPayload } from "../lib/reports-service";
import { formatReportCsv } from "../lib/report-csv";
import { cappedPostgrest } from "./fixtures/capped-postgrest";

const now = new Date("2026-09-10T18:00:00Z");
const start = new Date("2026-09-10T00:00:00Z");
const end = new Date("2026-09-11T00:00:00Z");
function rows(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `s-${String(i).padStart(6, "0")}`, item_id: null as string | null,
    started_at: "2026-09-10T10:00:00.000001Z", ended_at: null, duration_seconds: 60 as number | null, words_estimated: 99999 }));
}

test("concurrent equivalent queries share their original promise; scopes, bounds and projections are distinct", async () => {
  const fixture = cappedPostgrest({ reading_sessions: rows(250) }, { cap: 100 });
  const context = createAnalyticsQueryContext(fixture.client);
  const first = context.sessions(start, end, "details");
  assert.equal(context.sessions(new Date(start), new Date(end), "details"), first);
  const [a, b] = await Promise.all([first, context.sessions(start, end, "streak")]);
  assert.deepEqual(a, b);
  assert.equal(fixture.requests.length, 5); // boundary + 3 data pages + empty
  assert.equal((await context.sessions(end, new Date("2026-09-12"), "details")).length, 0);
  assert.equal(fixture.requests.length, 6);
  const lean = createAnalyticsQueryContext(fixture.client);
  await lean.sessions(start, end, "streak");
  await lean.sessions(start, end, "details");
  assert.equal(fixture.requests.length, 16, "streak projection cannot supply item metadata");
  assert.throws(() => context.assertClient(cappedPostgrest({}).client), /different client/);
});

test("containing inputs preserve [start,end) for tied microseconds and comparison/history cutoffs", async () => {
  const data = rows(3);
  data[0].started_at = "2026-09-10T00:00:00.000000Z";
  data[1].started_at = "2026-09-10T00:00:00.000001Z";
  data[2].started_at = "2026-09-11T00:00:00.000001Z";
  const fixture = cappedPostgrest({ reading_sessions: data }, { cap: 1 });
  const context = createAnalyticsQueryContext(fixture.client);
  await context.sessions(null, new Date("2026-09-12"), "details");
  assert.deepEqual((await context.sessions(start, end, "details")).map(r=>r.id), [data[0].id,data[1].id]);
  assert.deepEqual((await context.sessions(end, new Date("2026-09-12"), "details")).map(r=>r.id), [data[2].id]);
  assert.equal(fixture.requests.length, 5);
});

for (const cap of [100, 300, 1000]) {
  test(`actual Overview/report payloads: complete totals, fixed histogram and CSV under cap ${cap}`, async () => {
    const fixture = cappedPostgrest({ reading_sessions: rows(1200) }, { cap });
    for (const period of ["month", "today", "all-time"] as const) {
      const result = await getOverviewReadingMetrics(fixture.client, period, null, null, now, "Europe/Athens");
      for (const m of [result.metrics, result.todayMetrics, result.allTimeMetrics]) {
        assert.equal(m.totals.sessionsCount, 1200);
        assert.equal(m.totals.totalReadingTimeSeconds, 72000);
        assert.equal(m.totals.wordsRead, 270000);
        assert.equal(m.currentStreakDays, 1);
      }
      assert.deepEqual(Object.keys(toOverviewClientPayload(result)), ["metrics"]);
    }
    for (const period of ["weekly", "monthly", "yearly"] as const) {
      const report = await getReadingReport(fixture.client, period, { now, reference: period === "yearly" ? "2026" : period === "monthly" ? "2026-09" : "2026-09-10" });
      assert.equal(report.timeline.length, 1200);
      assert.deepEqual(report.sessionLengthHistogram, [{label:"<5 min",count:1200},{label:"5–<15 min",count:0},{label:"15–<30 min",count:0},{label:"≥30 min",count:0}]);
      for (const payload of [toReportsClientPayload(report), toYearInReadingClientPayload(report)]) {
        assert.equal("timeline" in payload, false);
        const csv = formatReportCsv(payload.metrics.heatmap).split("\n").slice(1).map(r=>r.split(","));
        assert.equal(csv.reduce((n,r)=>n+Number(r[1]),0),72000);
        assert.equal(csv.reduce((n,r)=>n+Number(r[2]),0),270000);
        assert.equal(csv.reduce((n,r)=>n+Number(r[3]),0),1200);
      }
    }
  });
}

test("histogram boundaries include zero/null sessions and preserve per-session rounding and nullable metadata", async () => {
  const durations = [null,-1,0,1,1,299,300,899,900,1799,1800,1801];
  const data = rows(durations.length).map((r,i)=>({...r,duration_seconds:durations[i],item_id:i%2===0?"item":null}));
  const fixture = cappedPostgrest({reading_sessions:data,matter_items:[{id:"item",title:null,url:null,source:null,author:null,word_count:null,estimated_reading_time_minutes:null}]},{cap:2});
  const report = await getReadingReport(fixture.client,"daily",{now,reference:"2026-09-10"});
  assert.deepEqual(report.sessionLengthHistogram.map(b=>b.count),[6,2,2,2]);
  assert.equal(report.metrics.totals.sessionsCount,12);
  // Independent integer fixture expectations, rounded before summation.
  assert.equal(report.metrics.totals.totalReadingTimeSeconds,7800);
  assert.equal(report.metrics.totals.wordsRead,29250);
  assert.equal(report.timeline.find(s=>s.id==="s-000003")?.wordsRead,4);
  assert.equal(report.longformReads.find(r=>r.itemId==="item")?.estimatedReadingTimeMinutes,null);
});

test("10,037 sessions retain complete totals while client size stays bounded within the same month", async () => {
  const sizes: number[] = [];
  for (const count of [1200,10037]) {
    const report = await getReadingReport(cappedPostgrest({reading_sessions:rows(count)},{cap:100}).client,"monthly",{now,reference:"2026-09"});
    const payload = toReportsClientPayload(report);
    assert.equal(payload.metrics.totals.sessionsCount,count);
    assert.equal(payload.metrics.totals.wordsRead,count*225);
    assert.equal(payload.sessionLengthHistogram[0].count,count);
    sizes.push(Buffer.byteLength(JSON.stringify(payload)));
  }
  assert.ok(sizes[1]-sizes[0]<100, `${sizes}: only integer digit counts grow`);
});

for (const failure of ["session-page", "tag-batch"] as const) {
  test(`${failure}: simultaneous reuse propagates failure; new requests recover and see changed data`, async () => {
    const data = rows(250).map((r,i)=>({...r,item_id:`item-${i}`}));
    let fail = true;
    const fixture = cappedPostgrest({reading_sessions:data}, {cap:100,respond:request=> {
      if (fail && ((failure==="session-page" && request.table==="reading_sessions" && request.number===3)
        || (failure==="tag-batch" && request.table==="item_tags" && request.number===2))) return Response.json({message:"later failure",code:"XX000"},{status:500});
    }});
    const context = createAnalyticsQueryContext(fixture.client);
    const options = {range:{start,end},comparisonRange:null,now,timezone:"UTC",queryContext:context};
    const settled = await Promise.allSettled([getReadingMetrics(fixture.client,options),getReadingMetrics(fixture.client,options)]);
    for (const outcome of settled) { assert.equal(outcome.status,"rejected"); if(outcome.status==="rejected") assert.equal(outcome.reason.message,"later failure"); }
    fail=false;
    await assert.rejects(getReadingMetrics(fixture.client,options),e=>(e as {message:string}).message==="later failure");
    data.push({...data[0],id:"new"});
    const fresh = await getReadingMetrics(fixture.client,{...options,queryContext:createAnalyticsQueryContext(fixture.client)});
    assert.equal(fresh.totals.sessionsCount,251);
    data.push({...data[0],id:"newer"});
    const newer = await getReadingMetrics(fixture.client,{...options,queryContext:createAnalyticsQueryContext(fixture.client)});
    assert.equal(newer.totals.sessionsCount,252);
  });
}

test("metadata supersets coalesce equivalent/compatible ID sets and keep unrelated IDs separate", async () => {
  const links = Array.from({length:1200},(_,i)=>({item_id:"item",tag_id:`t-${i}`,matter_tags:{id:`t-${i}`,name:`Tag ${i}`}}));
  const fixture = cappedPostgrest({item_tags:links},{cap:100});
  const context = createAnalyticsQueryContext(fixture.client);
  const [a,b] = await Promise.all([context.tags(["item","other","item"]),context.tags(["other","item"])]);
  assert.deepEqual(a,b);
  assert.equal(a.get("item")?.length,1200);
  assert.equal(fixture.requests.length,13);
  await context.tags(["third"]);
  assert.equal(fixture.requests.length,14);
});

test("Reports keeps its captured timezone while awaiting weekly navigation", async () => {
  const original = process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE = "Europe/Athens";
  const fixture = cappedPostgrest({ reading_sessions: [{...rows(1)[0], started_at:"2026-09-27T21:30:00Z"}] }, {
    before: ({url}) => { if (url.searchParams.get("select") === "started_at") process.env.APP_TIMEZONE = "UTC"; },
  });
  try {
    const report = await getReadingReport(fixture.client,"weekly",{reference:"2026-09-28",now:new Date("2026-09-28T12:00:00Z")});
    assert.equal(report.metrics.range.timezone,"Europe/Athens");
    assert.equal(report.metrics.range.start?.toISOString(),"2026-09-27T21:00:00.000Z");
    assert.equal(report.latestWeekWithDataStartDate,"2026-09-28");
    assert.equal(report.metrics.totals.sessionsCount,1);
    assert.equal(report.metrics.historicalStreak?.asOfDate,"2026-10-04");
  } finally {
    if (original === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = original;
  }
});
