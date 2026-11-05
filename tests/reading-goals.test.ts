import test from "node:test";
import assert from "node:assert/strict";
import { currentGoalPeriod, goalProgress, parseGoalHours, remainingCalendarDays } from "../lib/reading-goals";
import { mutateReadingGoal, loadReadingGoals } from "../lib/reading-goals-service";
import type { MatterStatsSupabaseClient } from "../lib/supabase-queries";

test("decimal hours have exact second precision and reject unsupported inputs", () => {
  for (const [input, expected] of [["0.01",36],["1.25",4500],["2",7200],[" 2.10 ",7560]] as const) assert.equal(parseGoalHours(input), expected);
  for (const input of ["", "0", "-1", "NaN", "Infinity", "1e3", "1.001", "1,5", "9007199254740991", null, 3]) assert.equal(parseGoalHours(input), null);
});

test("Monday periods follow Athens across UTC, DST and year rollover", () => {
  const p = currentGoalPeriod("weekly", new Date("2026-11-01T22:00:00Z"));
  assert.equal(p.start, "2026-11-02"); assert.equal(p.end, "2026-11-09");
  assert.equal(p.startUtc.toISOString(), "2026-11-01T22:00:00.000Z");
  const spring = currentGoalPeriod("weekly", new Date("2026-03-29T09:00:00Z"));
  assert.equal((spring.endUtc.getTime()-spring.startUtc.getTime())/3600000,167);
  const autumn = currentGoalPeriod("weekly", new Date("2026-10-25T10:00:00Z"));
  assert.equal((autumn.endUtc.getTime()-autumn.startUtc.getTime())/3600000,169);
  assert.equal(currentGoalPeriod("yearly", new Date("2026-12-31T22:00:00Z")).start,"2027-01-01");
});

test("pace uses remaining local day fraction, leap days and DST day length", () => {
  const now = new Date("2026-10-23T09:00:00Z");
  const p = currentGoalPeriod("weekly", now);
  assert.equal(remainingCalendarDays(p,now),2.5);
  const v = goalProgress(21600,14400,p,now);
  assert.equal(v.remainingSeconds,7200); assert.equal(v.requiredSecondsPerDay,2880);
  for (const [time, fraction] of [["2026-03-29T09:00:00Z",12/23],["2026-10-25T10:00:00Z",12/25]] as const) {
    const date = new Date(time);
    assert.ok(Math.abs(remainingCalendarDays(currentGoalPeriod("weekly",date),date)-fraction)<1e-12);
  }
  const leap = currentGoalPeriod("yearly",new Date("2024-01-01T00:00:00Z"));
  assert.equal(remainingCalendarDays(leap,leap.startUtc),366);
  assert.equal(remainingCalendarDays(leap,new Date("2024-02-29T22:00:00Z")),306);
});

test("zero, exact, excess, ended and before-start stay finite and nonnegative", () => {
  const now = new Date("2026-11-05T10:00:00Z"), p = currentGoalPeriod("weekly",now);
  assert.equal(goalProgress(3600,0,p,now).percent,0);
  for (const actual of [3600,5400]) {
    const v=goalProgress(3600,actual,p,now);
    assert.equal(v.percent,actual/36); assert.equal(v.barPercent,100);
    assert.equal(v.remainingSeconds,0); assert.equal(v.requiredSecondsPerDay,0);
  }
  assert.equal(goalProgress(3600,0,p,p.endUtc).requiredSecondsPerDay,0);
  assert.equal(goalProgress(3600,0,p,new Date("2027-01-01Z")).ended,true);
  assert.equal(remainingCalendarDays(p,new Date("2020-01-01Z")),7);
});

const validForm = () => { const f = new FormData(); for(const [k,v] of Object.entries({type:"weekly",periodStart:"2026-11-02",hours:"1.25",operation:"save"})) f.set(k,v); return f; };
test("mutations authorize before validation/storage and reject stale or invalid input", async () => {
  let calls=0;
  const deps={authorize:async()=>{},client:()=>{calls++; throw Error("unexpected");},now:()=>new Date("2026-11-05T10:00Z"),refresh:()=>{}};
  await assert.rejects(()=>mutateReadingGoal({...deps,authorize:async()=>{throw Error("unauthorized");}},validForm()),/unauthorized/);
  for(const [key,value] of [["type","monthly"],["periodStart","2026-10-26"],["hours","NaN"],["hours","0"],["operation","delete"]]) {
    const f=validForm(); f.set(key,value); assert.equal((await mutateReadingGoal(deps,f))?.ok,false);
  }
  assert.equal(calls,0);
});

test("save, edit and disable affect only the identified period; failures preserve error state", async () => {
  const writes: unknown[]=[]; let refreshed=0;
  const query={upsert:(row:unknown,options:unknown)=>{writes.push([row,options]);return Promise.resolve({error:null});},update:(row:unknown)=>{writes.push(row);return query;},eq:(key:string,value:unknown)=>{writes.push([key,value]);return query;},then:(resolve:(value:unknown)=>void)=>Promise.resolve({error:null}).then(resolve)};
  const client={from:(table:string)=>{assert.equal(table,"reading_goals");return query;}} as unknown as MatterStatsSupabaseClient;
  const deps={authorize:async()=>{},client:()=>client,now:()=>new Date("2026-11-05T10:00Z"),refresh:()=>{refreshed++;}};
  const f=validForm(); assert.equal((await mutateReadingGoal(deps,f))?.ok,true);
  f.set("hours","2.01"); await mutateReadingGoal(deps,f);
  f.set("operation","disable"); await mutateReadingGoal(deps,f);
  assert.deepEqual(writes,[[{type:"weekly",period_start:"2026-11-02",target_seconds:4500,enabled:true},{onConflict:"type,period_start"}],[{type:"weekly",period_start:"2026-11-02",target_seconds:7236,enabled:true},{onConflict:"type,period_start"}],{enabled:false},["type","weekly"],["period_start","2026-11-02"]]);
  assert.equal(refreshed,3);
  assert.equal((await mutateReadingGoal({...deps,client:()=>{throw Error("offline");}},validForm()))?.ok,false);
});

test("goal read failure cannot become missing goal or zero activity",async()=>{
  const client={from:()=>{throw Error("unavailable");}} as unknown as MatterStatsSupabaseClient;
  const result=await loadReadingGoals(client,new Date("2026-11-05T10:00Z"));
  assert.equal(result.length,2); for(const v of result){assert.equal(v.state,"unavailable");assert.equal(v.progress,null);}
});

test("goal actuals use complete capped raw pagination and the captured-now cutoff", async () => {
  const { cappedPostgrest } = await import("./fixtures/capped-postgrest");
  const now = new Date("2026-11-05T10:00Z");
  const rows = Array.from({length: 1003},(_,i)=>({id:`s-${String(i).padStart(5,"0")}`,started_at:"2026-11-03T10:00:00Z",duration_seconds:7}));
  rows.push({id:"boundary",started_at:now.toISOString(),duration_seconds:999},{id:"old",started_at:"2026-11-01T21:59:59Z",duration_seconds:11});
  const {client:raw}=cappedPostgrest({reading_sessions:rows}, {cap:31});
  const client={from:(table:string)=>table==="reading_goals"?{select:()=>({eq:(_key:string,type:string)=>({eq:()=>({maybeSingle:async()=>({data:{type,period_start:type==="weekly"?"2026-11-02":"2026-01-01",target_seconds:3600,enabled:true},error:null})})})})}:raw.from(table as "reading_sessions")} as unknown as MatterStatsSupabaseClient;
  const result=await loadReadingGoals(client,now);
  assert.equal(result[0].progress?.actualSeconds,7021);
  assert.equal(result[1].progress?.actualSeconds,7032);
});

test("analytics outage preserves a configured goal with unavailable progress",async()=>{
  const client={from:(table:string)=>{
    if(table!=="reading_goals") throw Error("analytics offline");
    return {select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{type:"weekly",period_start:"2026-11-02",target_seconds:4500,enabled:true},error:null})})})})};
  }} as unknown as MatterStatsSupabaseClient;
  const result=await loadReadingGoals(client,new Date("2026-11-05T10:00Z"));
  for(const view of result){assert.equal(view.state,"available");assert.equal(view.goal?.target_seconds,4500);assert.equal(view.progress,null);}
});
