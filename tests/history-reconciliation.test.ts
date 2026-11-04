import assert from "node:assert/strict";
import test from "node:test";
import { reconcileHistory } from "../lib/history-reconciliation";
import { cappedPostgrest } from "./fixtures/capped-postgrest";

test("monthly and yearly paths reconcile over capped pages with independent expected totals", async()=>{
  process.env.APP_TIMEZONE="Europe/Athens";
  const rows = Array.from({length:1005},(_,i)=>({id:`s${String(i).padStart(4,"0")}`,item_id:null,started_at:"2024-02-29T21:59:59Z",duration_seconds:1,matter_items:null}));
  rows.push({id:"boundary",item_id:null,started_at:"2024-02-29T22:00:00Z",duration_seconds:0,matter_items:null});
  const client = cappedPostgrest({reading_sessions:rows},{cap:137}).client;
  for (const period of ["2024-02","2024","2023"]) {
    const result = await reconcileHistory(client,period,new Date("2026-01-01T00:00:00Z"));
    assert.equal(result.status,"agree");
    assert.equal(result.linkage.unlinked,period==="2024"?1006:period==="2024-02"?1005:0);
    for(const row of result.comparisons) {
      const expected = period==="2023" ? 0 : {sessions:period==="2024"?1006:1005,seconds:1005,words:4020,activeDays:1}[row.metric];
      assert.equal(row.expected,expected);
      assert.equal(row.actual,expected);
    }
  }
});

test("Athens DST and year boundary vectors; nullable stored fields stay separate",async()=>{
  const vectors = [
    ["2024-12-31T21:59:59Z",1], ["2024-12-31T22:00:00Z",60],
    ["2025-03-30T00:59:59Z",1], ["2025-03-30T01:00:00Z",1],
    ["2025-03-31T20:59:59Z",1], ["2025-03-31T21:00:00Z",60],
    ["2025-10-26T00:59:59Z",1], ["2025-10-26T01:00:00Z",1],
  ] as const;
  const rows = vectors.map(([started_at,duration_seconds],i)=>({id:`v${i}`,item_id:null,started_at,duration_seconds,matter_items:null}));
  const client = cappedPostgrest({reading_sessions:[...rows,{id:"unknown",item_id:null,started_at:null,duration_seconds:null,matter_items:null}]}).client;
  for(const [period,sessions,seconds,words,days] of [["2024",1,1,4,1],["2025-03",3,3,12,2],["2025-10",2,2,8,1]] as const) {
    const result=await reconcileHistory(client,period,new Date("2026-02-01T00:00:00Z"));
    assert.equal(result.status,"agree");
    assert.deepEqual(result.quality,{missingTimestamp:1,nullDuration:1});
    const expected={sessions,seconds,words,activeDays:days};
    for(const row of result.comparisons) assert.equal(row.actual,expected[row.metric]);
  }
});

test("concurrent change is inconclusive even if totals agree",async()=>{
  const rows=[{id:"one",item_id:null,started_at:"2024-01-01T00:00:00Z",duration_seconds:1,matter_items:null}];
  let boundaries=0;
  const client=cappedPostgrest({reading_sessions:rows},{before:({table,url})=>{
    if(table==="reading_sessions" && url.searchParams.get("select")==="id,item_id,started_at,duration_seconds" && url.searchParams.get("limit")==="1" && ++boundaries===2) rows[0].duration_seconds=2;
  }}).client;
  assert.equal((await reconcileHistory(client,"2024")).status,"inconclusive");
});
