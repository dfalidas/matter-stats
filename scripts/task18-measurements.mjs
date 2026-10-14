// Synthetic HTTP measurements of actual analytics entrypoints. Run after test compilation.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
const { cappedPostgrest } = require('../.test-build/tests/fixtures/capped-postgrest.js');
const overviewService = require('../.test-build/lib/overview-service.js');
const reportsService = require('../.test-build/lib/reports-service.js');
const { formatReportCsv } = require('../.test-build/lib/report-csv.js');
const now = new Date('2026-09-10T18:00:00Z');
process.env.APP_TIMEZONE = 'Europe/Athens';
const measurements = [];
for (const [count, cap] of [[1200,100],[1200,300],[1200,1000],[10037,100]]) {
  const items = Array.from({length:120}, (_,i)=>({id:`item-${i}`,title:`Article ${i}`,url:null,source:'Source',author:'Author',word_count:null,estimated_reading_time_minutes:null}));
  const rows = Array.from({length:count},(_,i)=>({id:`s-${String(i).padStart(6,'0')}`,item_id:i%10===0?null:items[i%120].id,started_at:'2026-09-10T10:00:00.000000Z',ended_at:null,duration_seconds:60,words_estimated:999999}));
  const tags = Array.from({length:1200},(_,i)=>({item_id:items[i%120].id,tag_id:`tag-${i}`,matter_tags:{id:`tag-${i}`,name:`Tag ${i}`}}));
  for (const view of ['overview-month','overview-today','overview-all-time','reports-weekly','reports-monthly','reports-yearly','year-in-reading']) {
    const fixture = cappedPostgrest({reading_sessions:rows,matter_items:items,item_tags:tags},{cap});
    const start = performance.now();
    let payload, metrics, completeOutput;
    if (view.startsWith('overview')) {
      const period = view.slice(9);
      const result = await overviewService.getOverviewReadingMetrics(fixture.client,period,null,null,now,'Europe/Athens');
      const projection = overviewService.toOverviewClientPayload?.(result) ?? result;
      payload = {ok:true,...projection,library:[],dataStatus:{lastSuccessfulSync:null,coverage:'unverified'}};
      metrics = result.metrics;
      completeOutput = result;
    } else {
      const period = view==='year-in-reading'?'yearly':view.slice(8);
      const report = await reportsService.getReadingReport(fixture.client,period,{now,reference:period==='yearly'?'2026':period==='monthly'?'2026-09':'2026-09-10'});
      const projection = view==='year-in-reading' ? reportsService.toYearInReadingClientPayload?.(report) : reportsService.toReportsClientPayload?.(report);
      payload = {ok:true,report:projection??report};
      metrics = report.metrics;
      completeOutput = {period:report.period,metrics:report.metrics,timeline:report.timeline,longformReads:report.longformReads,latestWeekWithDataStartDate:report.latestWeekWithDataStartDate};
    }
    const serialized = JSON.stringify(payload);
    const elapsedMs = Number((performance.now()-start).toFixed(2));
    const totals = metrics.totals;
    if(totals.sessionsCount!==count || totals.totalReadingTimeSeconds!==count*60 || totals.wordsRead!==count*225) throw new Error('Incomplete measurement totals');
    const csv = formatReportCsv(metrics.heatmap).split('\n').slice(1).map(x=>x.split(','));
    if(csv.reduce((n,r)=>n+Number(r[3]),0)!==count) throw new Error('Incomplete CSV');
    measurements.push({view,count,cap,outputSha256:createHash('sha256').update(JSON.stringify(completeOutput)).digest('hex'),requests:fixture.requests.length,rows:fixture.requests.reduce((n,r)=>n+r.rowCount,0),responseBytes:fixture.requests.reduce((n,r)=>n+r.responseBytes,0),payloadBytes:Buffer.byteLength(serialized),elapsedMs});
  }
}
console.log(JSON.stringify({method:'Installed Supabase client with in-memory capped HTTP fixture; UTF-8 JSON response bodies and page result props; includes boundary/exhaustion/ID-batch requests; one invocation per case in one process; fixture timestamp cache can warm; synthetic timing only',node:process.version,platform:`${process.platform}/${process.arch}`,now:now.toISOString(),timezone:process.env.APP_TIMEZONE,measurements},null,2));
