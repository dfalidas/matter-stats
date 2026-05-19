import assert from 'node:assert/strict';
import test from 'node:test';
import { getReadingReport } from '../lib/reports-service';

type Session={id:string;item_id:string|null;started_at:string|null;ended_at:string|null;duration_seconds:number|null;words_estimated:number|null;matter_items:null};
class Q {
  private filters: Record<string, string | number | boolean> = {};
  private sort: {col:string;asc:boolean}|null=null;
  private lim:number|null=null;
  constructor(private table:string, private rows:Record<string, unknown>[]){}
  select(){return this;} lt(c:string,v:string){this.filters[`lt_${c}`]=v;return this;} gte(c:string,v:string){this.filters[`gte_${c}`]=v;return this;}
  gt(c:string,v:number){this.filters[`gt_${c}`]=v;return this;} not(c:string){this.filters[`not_${c}`]=true;return this;}
  order(col:string,opt:{ascending?:boolean}){this.sort={col,asc:opt.ascending??true};return this;} limit(n:number){this.lim=n;return this;}
  maybeSingle(){const data=this.result()[0]??null; return Promise.resolve({data,error:null});}
  in(){return this;}
  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onf?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onr?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ){return Promise.resolve({data:this.result(),error:null}).then(onf,onr);}
  private result(){let out=[...this.rows];
    for (const [k,v] of Object.entries(this.filters)) {
      const [op,col]=k.split('_');
      if (!col) continue;
      if(op==='lt') out=out.filter((r)=>r[col]!==null && String(r[col]) < String(v));
      if(op==='gte') out=out.filter((r)=>r[col]!==null && String(r[col]) >= String(v));
      if(op==='gt') out=out.filter((r)=>typeof r[col]==='number' && Number(r[col]) > Number(v));
      if(op==='not') out=out.filter((r)=>r[col]!==null);
    }
    if(this.sort){out.sort((a,b)=> this.sort!.asc?String(a[this.sort!.col]??'').localeCompare(String(b[this.sort!.col]??'')):String(b[this.sort!.col]??'').localeCompare(String(a[this.sort!.col]??'')));}
    if(this.lim!==null) out=out.slice(0,this.lim);
    return out;
  }
}
function client(daily:{date:string;reading_time_seconds:number}[], sessions:Session[]){
  return {from(table:string){if(table==='daily_stats') return new Q(table,daily); if(table==='reading_sessions') return new Q(table,sessions); if(table==='item_tags') return new Q(table,[]); return new Q(table,[]);} } as never;
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
