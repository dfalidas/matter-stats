import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.test-build');
const require = Module.createRequire(import.meta.url);
const { cappedPostgrest } = require(path.join(root,'tests/fixtures/capped-postgrest.js'));
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
let client, authorized = true, guardCalls = 0;
Module._resolveFilename = function(request,parent,...rest) {
  if(request.startsWith('@/')) request = path.join(root,request.slice(2))+'.js';
  return originalResolve.call(this,request,parent,...rest);
};
Module._load = function(request,parent,...rest) {
  if(request === '@/lib/supabase-admin') return { getSupabaseAdminClient:()=>client };
  if(request === '@/lib/require-auth') return { requireAccessSession:async()=> { guardCalls++; if(!authorized) throw new Error('denied'); } };
  if(request === '../_components/page-shell') return { PageShell:()=>null };
  if(request === './dashboard-overview') return { DashboardOverview:()=>null };
  if(request === './reports-overview') return { ReportsOverview:()=>null };
  if(request === './year-in-reading-overview') return { YearInReadingOverview:()=>null };
  return originalLoad.call(this,request,parent,...rest);
};
const DashboardPage = require(path.join(root,'app/dashboard/page.js')).default;
const ReportsPage = require(path.join(root,'app/reports/page.js')).default;
const YearPage = require(path.join(root,'app/year-in-reading/page.js')).default;
Module._load = originalLoad;
Module._resolveFilename = originalResolve;

function sessions(count) {
  return Array.from({length:count},(_,i)=>({id:`s-${String(i).padStart(6,'0')}`,item_id:null,started_at:'2026-09-10T10:00:00Z',duration_seconds:60}));
}
test('real server pages construct bounded client props; calendar CSV and totals remain complete',async(t)=> {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-10T18:00:00Z')});
  const oldTimezone = process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE='Europe/Athens';
  try {
    const sizes=[];
    for(const count of [1200,10037]) {
      const fixture = cappedPostgrest({reading_sessions:sessions(count)},{cap:100});
      client = fixture.client;
      const overview = (await DashboardPage({searchParams:Promise.resolve({period:'month'})})).props.children.find(child=>child?.props?.metricsResult).props.metricsResult;
      assert.equal(overview.ok,true);
      assert.equal(overview.metrics.totals.sessionsCount,count);
      assert.equal('todayMetrics' in overview,false);
      assert.equal('allTimeMetrics' in overview,false);
      assert.deepEqual(Object.keys(overview.metrics).sort(),['comparison','heatmap','range','totals']);
      const reportSizes=[];
      for(const period of ['weekly','monthly','yearly']) {
        const reference=period==='yearly'?'2026':period==='monthly'?'2026-09':'2026-09-10';
        const props = (await ReportsPage({searchParams:Promise.resolve({period,date:reference})})).props.children.props;
        assert.equal(props.reportsResult.ok,true);
        const report=props.reportsResult.report;
        assert.equal(report.metrics.totals.sessionsCount,count);
        assert.equal(report.metrics.totals.totalReadingTimeSeconds,count*60);
        assert.equal(report.metrics.totals.wordsRead,count*225);
        assert.equal('timeline' in report,false);
        assert.equal(report.sessionLengthHistogram[0].count,count);
        reportSizes.push(Buffer.byteLength(JSON.stringify(props)));
      }
      const recap=(await YearPage({})).props.children.find(child=>child?.props?.recapResult).props.recapResult;
      assert.equal(recap.ok,true);
      assert.equal(recap.report.metrics.totals.sessionsCount,count);
      assert.equal('timeline' in recap.report,false);
      assert.equal('sessionLengthHistogram' in recap.report,false);
      assert.equal('recentReads' in recap.report.metrics,false);
      assert.equal('comparison' in recap.report.metrics,false);
      assert.ok(recap.report.longformReads.length<=4);
      sizes.push(reportSizes);
    }
    for(let i=0;i<3;i++) assert.ok(sizes[1][i]-sizes[0][i]<100,JSON.stringify(sizes));
    assert.equal(guardCalls,10);
  } finally {
    t.mock.timers.reset();
    if(oldTimezone===undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE=oldTimezone;
  }
});
test('all protected page guards run before any database access',async()=> {
  authorized=false;
  const fixture=cappedPostgrest({}); client=fixture.client;
  try {
    for(const page of [DashboardPage,ReportsPage,YearPage]) await assert.rejects(page({}),/denied/);
    assert.equal(fixture.requests.length,0);
  } finally {authorized=true;}
});
