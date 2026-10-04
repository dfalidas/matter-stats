import assert from 'node:assert/strict';
import test from 'node:test';
import { getReadingReport, isValidReportReference, resolveReportRange } from '../lib/reports-service';

type Session={id:string;item_id:string|null;started_at:string|null;ended_at:string|null;duration_seconds:number|null;words_estimated:number|null;matter_items:null|{id:string;title:string|null;url:string|null;source:string|null;author:string|null;estimated_reading_time_minutes:number|null;word_count:number|null}};
class Q {
  private filters: Record<string, string | number | boolean> = {};
  private sort: {col:string;asc:boolean}|null=null;
  private lim:number|null=null;
  private window:[number,number]|null=null;
  constructor(private table:string, private rows:Record<string, unknown>[], private onMaybeSingle?: (table:string)=>void){}
  select(){return this;} lt(c:string,v:string){this.filters[`lt:${c}`]=v;return this;} gte(c:string,v:string){this.filters[`gte:${c}`]=v;return this;}
  gt(c:string,v:number){this.filters[`gt:${c}`]=v;return this;} not(c:string){this.filters[`not:${c}`]=true;return this;}
  order(col:string,opt:{ascending?:boolean}){this.sort={col,asc:opt.ascending??true};return this;} limit(n:number){this.lim=n;return this;}
  range(from:number,to:number){this.window=[from,to];return this;}
  maybeSingle(){return Promise.resolve().then(()=>{this.onMaybeSingle?.(this.table); const data=this.result()[0]??null; return {data,error:null};});}
  in(){return this;}
  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onf?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onr?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ){return Promise.resolve({data:this.result(),error:null}).then(onf,onr);}
  private result(){let out=[...this.rows];
    for (const [k,v] of Object.entries(this.filters)) {
      const [op,col]=k.split(':');
      if (!col) continue;
      if(op==='lt') out=out.filter((r)=>r[col]!==null && String(r[col]) < String(v));
      if(op==='gte') out=out.filter((r)=>r[col]!==null && String(r[col]) >= String(v));
      if(op==='gt') out=out.filter((r)=>typeof r[col]==='number' && Number(r[col]) > Number(v));
      if(op==='not') out=out.filter((r)=>r[col]!==null);
    }
    if(this.sort){out.sort((a,b)=> this.sort!.asc?String(a[this.sort!.col]??'').localeCompare(String(b[this.sort!.col]??'')):String(b[this.sort!.col]??'').localeCompare(String(a[this.sort!.col]??'')));}
    if(this.lim!==null) out=out.slice(0,this.lim);
    if(this.window) out=out.slice(this.window[0],this.window[1]+1);
    return out;
  }
}
function client(daily:{date:string;reading_time_seconds:number}[], sessions:Session[], onMaybeSingle?: (table:string)=>void){
  return {from(table:string){if(table==='daily_stats') return new Q(table,daily,onMaybeSingle); if(table==='reading_sessions') return new Q(table,sessions,onMaybeSingle); if(table==='item_tags') return new Q(table,[],onMaybeSingle); return new Q(table,[],onMaybeSingle);} } as never;
}

test('weekly report stays empty for empty current week and exposes latest week with data', async()=>{
  const c=client([{date:'2026-05-08',reading_time_seconds:1200}],[]);
  const report=await getReadingReport(c,'weekly',{weekStartDate:'2026-05-11'});
  assert.equal(report.metrics.totals.totalReadingTimeSeconds,0);
  assert.equal(report.metrics.range.startDate,'2026-05-11');
});

test('weekly report resolves latest week with data fallback from reading sessions when daily stats missing', async()=>{
  const c=client([],[{id:'s1',item_id:null,started_at:'2026-05-07T10:00:00Z',ended_at:null,duration_seconds:600,words_estimated:200,matter_items:null}]);
  const report=await getReadingReport(c,'weekly',{weekStartDate:'2026-05-11'});
  assert.equal(report.metrics.range.startDate,'2026-05-11');
});

test('weekly report renders populated historical week with null item_id sessions', async()=>{
  const c=client([{date:'2026-05-08',reading_time_seconds:1200}],[{id:'s1',item_id:null,started_at:'2026-05-07T10:00:00Z',ended_at:null,duration_seconds:600,words_estimated:200,matter_items:null}]);
  const report=await getReadingReport(c,'weekly',{weekStartDate:'2026-05-04'});
  assert.equal(report.metrics.range.startDate,'2026-05-04');
  assert.ok(report.metrics.totals.sessionsCount >= 0);
  assert.ok(report.timeline.length >= 0);
});

test('report forwards its request-scoped now and exposes a separate selected-date streak', async()=>{
  const sessions: Session[] = [
    {id:'s26',item_id:null,started_at:'2026-09-26T10:00:00Z',ended_at:null,duration_seconds:60,words_estimated:225,matter_items:null},
    {id:'s27',item_id:null,started_at:'2026-09-27T10:00:00Z',ended_at:null,duration_seconds:60,words_estimated:225,matter_items:null},
    {id:'s28',item_id:null,started_at:'2026-09-28T10:00:00Z',ended_at:null,duration_seconds:60,words_estimated:225,matter_items:null},
  ];
  const report=await getReadingReport(client([],sessions),'daily',{reference:'2026-09-28',now:new Date('2026-09-30T12:00:00Z')});
  assert.equal(report.metrics.currentStreakDays,0);
  assert.deepEqual(report.metrics.historicalStreak,{asOfDate:'2026-09-28',days:3});
});

const midnightSessions: Session[] = [
  {id:'midnight-26',item_id:null,started_at:'2026-09-26T10:00:00Z',ended_at:null,duration_seconds:60,words_estimated:225,matter_items:null},
  {id:'midnight-27',item_id:null,started_at:'2026-09-27T10:00:00Z',ended_at:null,duration_seconds:60,words_estimated:225,matter_items:null},
];

test('daily report captures default now once when the clock crosses Athens midnight', async(t)=>{
  const oldTimezone=process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE='Europe/Athens';
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-28T20:59:59.999Z')});
  try {
    const pending=getReadingReport(client([],midnightSessions),'daily');
    t.mock.timers.tick(1);
    const report=await pending;
    assert.equal(report.metrics.range.startDate,'2026-09-28');
    assert.equal(report.metrics.currentStreakDays,2);
  } finally {
    t.mock.timers.reset();
    if(oldTimezone===undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE=oldTimezone;
  }
});

test('weekly report retains captured default now while awaiting its latest-week lookup', async(t)=>{
  const oldTimezone=process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE='Europe/Athens';
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-28T20:59:59.999Z')});
  let advanced=false;
  try {
    const report=await getReadingReport(client([],midnightSessions,(table)=>{
      if(table==='daily_stats'&&!advanced){advanced=true;t.mock.timers.tick(1);}
    }),'weekly');
    assert.equal(advanced,true);
    assert.equal(report.metrics.range.startDate,'2026-09-28');
    assert.equal(report.metrics.currentStreakDays,2);
  } finally {
    t.mock.timers.reset();
    if(oldTimezone===undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE=oldTimezone;
  }
});

test('validates URL-persisted report references by period',()=>{
  assert.equal(isValidReportReference('weekly','2026-02-29'),false);
  assert.equal(isValidReportReference('weekly','2028-02-29'),true);
  assert.equal(isValidReportReference('monthly','2026-13'),false);
  assert.equal(isValidReportReference('monthly','2026-09'),true);
  assert.equal(isValidReportReference('yearly','2026'),true);
});

test('resolves historical week, month, and year at Athens local boundaries',()=>{
  const oldTimezone=process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE='Europe/Athens';
  try {
    const week=resolveReportRange('weekly','2026-09-03');
    assert.equal(week.start.toISOString(),'2026-08-30T21:00:00.000Z');
    assert.equal(week.end.toISOString(),'2026-09-06T21:00:00.000Z');
    const month=resolveReportRange('monthly','2026-09');
    assert.equal(month.start.toISOString(),'2026-08-31T21:00:00.000Z');
    assert.equal(month.end.toISOString(),'2026-09-30T21:00:00.000Z');
    const year=resolveReportRange('yearly','2026');
    assert.equal(year.start.toISOString(),'2025-12-31T22:00:00.000Z');
    assert.equal(year.end.toISOString(),'2026-12-31T22:00:00.000Z');
  } finally {
    if(oldTimezone===undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE=oldTimezone;
  }
});

test('report totals, timeline, heatmap, and grouped longform sum one-second session estimates', async()=>{
  const item={id:'same',title:'Same article',url:null,source:'Source',author:'Author',estimated_reading_time_minutes:5,word_count:1000};
  const sessions: Session[]=[0,1,2].map((index)=>({id:`tiny-${index}`,item_id:'same',started_at:`2026-10-04T10:00:0${index}Z`,ended_at:null,duration_seconds:1,words_estimated:index===0?999:null,matter_items:item}));
  const report=await getReadingReport(client([],sessions),'daily',{reference:'2026-10-04',now:new Date('2026-10-04T12:00:00Z')});
  assert.equal(report.metrics.totals.wordsRead,12);
  assert.equal(report.metrics.heatmap.find((day)=>day.date==='2026-10-04')?.wordsRead,12);
  assert.deepEqual(report.timeline.map((session)=>session.wordsRead),[4,4,4]);
  assert.equal(report.longformReads[0]?.wordsRead,12);
});
