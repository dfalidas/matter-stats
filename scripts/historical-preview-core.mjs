import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const contract = JSON.parse(readFileSync(new URL("../lib/estimation-contract.json", import.meta.url), "utf8"));
const metrics = ["reading_time_seconds", "words_read", "sessions_count"];
const zero = () => Object.fromEntries(metrics.map(k => [k, 0]));
const number = v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const add = (a, b) => { for (const k of metrics) { a[k] += b[k]; if (!Number.isSafeInteger(a[k])) throw new Error("Unsafe aggregate"); } return a; };
const diff = (a, b) => Object.fromEntries(metrics.map(k => [k, a[k] - b[k]]));
export function validDate(v) { return typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v; }
export function validateScope({ start, end, timezone }) {
  if (!validDate(start) || !validDate(end) || start >= end) throw new Error("Require valid --start and exclusive --end calendar dates");
  if ((Date.parse(end)-Date.parse(start))/86400000 > 3660) throw new Error("Range exceeds 3660 days; partition explicitly, no truncated report");
  if (!timezone || typeof timezone !== "string") throw new Error("Explicit timezone required");
  try { new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(0); } catch { throw new Error("Invalid timezone"); }
}
function formatter(zone) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year:"numeric", month:"2-digit", day:"2-digit" });
  return t => { const parts = Object.fromEntries(f.formatToParts(new Date(t)).map(p=>[p.type,p.value])); return `${parts.year}-${parts.month}-${parts.day}`; };
}
function timestamp(v) {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\d[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3])(?::?[0-5]\d)?)$/.test(v)) return false;
  return validDate(v.slice(0,10)) && Number.isFinite(Date.parse(v));
}

/** Streaming reducer: memory bounded by explicit date range and timezone count, never session count. */
export function createReconciliation(scope) {
  validateScope(scope);
  const localDay = formatter(scope.timezone), days = new Map(), oldZones = new Map();
  const invalid = { sessions: {}, daily: {}, sessionRows: 0, dailyRows: 0, unlocatableSessions: 0, affectedLocalDays: {} };
  const provenance = { canonical: 0, legacyUnknown: 0, other: 0 };
  const inScope = d => d >= scope.start && d < scope.end;
  const day = d => { if (!days.has(d)) days.set(d, { date:d, proposed:zero(), storedSessionWords:0, unavailableStoredSessionWords:0, old:null, oldProvenance:null }); return days.get(d); };
  const bad = (kind, reasons) => { invalid[kind === "sessions" ? "sessionRows" : "dailyRows"]++; for (const r of reasons) invalid[kind][r] = (invalid[kind][r] ?? 0)+1; };
  // The source stream must present daily rows first to establish only trustworthy old zones.
  function daily(r) {
    const reasons = [];
    if (!validDate(r.date)) reasons.push("invalid_date");
    for (const k of metrics) if (!number(r[k])) reasons.push(`invalid_${k}`);
    if (reasons.length) { bad("daily",reasons); return; }
    if (!inScope(r.date)) return;
    const d=day(r.date); if (d.old) throw new Error("Duplicate daily row");
    d.old=Object.fromEntries(metrics.map(k=>[k,r[k]])); d.oldProvenance=r.reading_provenance ?? null;
    const p=d.oldProvenance;
    if (p?.calendarMethod === contract.calendarMethod && typeof p.timezone === "string") {
      if (!oldZones.has(p.timezone)) {
        let oldDay;
        try { oldDay=formatter(p.timezone); } catch { bad("daily",["invalid_provenance_timezone"]); return; }
        if (oldZones.size >= 32) throw new Error("Too many provenance timezones; report not truncated");
        oldZones.set(p.timezone,{ day:oldDay, stored:new Map(), canonical:new Map(), unavailable:new Set() });
      }
    }
  }
  function session(r) {
    const reasons=[];
    if (typeof r.id !== "string" || !r.id.trim()) reasons.push("invalid_id");
    if (!number(r.duration_seconds)) reasons.push("invalid_duration");
    if (!timestamp(r.started_at)) reasons.push("invalid_timestamp");
    if (number(r.duration_seconds) && !Number.isSafeInteger(Math.round(r.duration_seconds/60*contract.wpm))) reasons.push("unsafe_word_estimate");
    if (reasons.length) { bad("sessions",reasons); if (!timestamp(r.started_at)) invalid.unlocatableSessions++; else { const d=localDay(r.started_at); if(inScope(d))invalid.affectedLocalDays[d]=(invalid.affectedLocalDays[d]??0)+1; } return; }
    const words=Math.round(r.duration_seconds/60*contract.wpm), date=localDay(r.started_at);
    if (inScope(date)) {
      provenance[r.word_estimation_method === contract.wordMethod ? "canonical" : r.word_estimation_method == null ? "legacyUnknown" : "other"]++;
      const d=day(date); add(d.proposed,{reading_time_seconds:r.duration_seconds,words_read:words,sessions_count:1});
      if (number(r.words_estimated)) { d.storedSessionWords+=r.words_estimated; if (!Number.isSafeInteger(d.storedSessionWords)) throw new Error("Unsafe stored words aggregate"); }
      else d.unavailableStoredSessionWords++;
    }
    for (const z of oldZones.values()) {
      const oldDate=z.day(r.started_at); if (!inScope(oldDate)) continue;
      z.canonical.set(oldDate,add(z.canonical.get(oldDate)??zero(),{reading_time_seconds:r.duration_seconds,words_read:words,sessions_count:1}));
      if (number(r.words_estimated)) z.stored.set(oldDate,add(z.stored.get(oldDate)??zero(),{reading_time_seconds:r.duration_seconds,words_read:r.words_estimated,sessions_count:1}));
      else z.unavailable.add(oldDate);
    }
  }
  function finish(source) {
    const daily=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>{
      const z=oldZones.get(d.oldProvenance?.timezone);
      const trusted=d.oldProvenance?.calendarMethod === contract.calendarMethod && z && !z.unavailable.has(d.date);
      const oldCanonical=trusted ? z.canonical.get(d.date)??zero() : null;
      const oldStored=trusted ? z.stored.get(d.date)??zero() : null;
      return { ...d, storedSessionWords:d.unavailableStoredSessionWords ? null : d.storedSessionWords,
        sessionWordDelta:d.unavailableStoredSessionWords ? null : d.proposed.words_read-d.storedSessionWords,
        delta:d.old ? diff(d.proposed,d.old) : null, missingRollup:d.old===null,
        staleDateWouldBecomeEmpty:!!d.old && d.proposed.sessions_count===0,
        explanation:trusted ? { status:"known_calendar_counterfactual", wordMethodDifference:diff(oldCanonical,oldStored), timezoneReassignment:diff(d.proposed,oldCanonical), unexplainedResidual:diff(oldStored,d.old) }
          : { status:"unavailable", wordMethodDifference:null, timezoneReassignment:null, unexplainedResidual:null, reason:"Old calendar provenance or stored session-word baseline unavailable; equality does not identify a method." } };
    });
    const months=new Map();
    for (const d of daily) {
      const month=d.date.slice(0,7); if (!months.has(month)) months.set(month,{month,old:zero(),proposed:zero(),storedSessionWords:0,unavailableStoredSessionWords:0,missingRollups:0,staleDates:0,unexplainedDays:0, explanation:{wordMethodDifference:zero(),timezoneReassignment:zero(),unexplainedResidual:zero()}});
      const m=months.get(month); add(m.proposed,d.proposed); if(d.old) add(m.old,d.old); else m.missingRollups++;
      if(d.staleDateWouldBecomeEmpty)m.staleDates++; if(d.explanation.status==="unavailable")m.unexplainedDays++; else for(const k of Object.keys(m.explanation)) { for(const metric of metrics)m.explanation[k][metric]+=d.explanation[k][metric]; }
      m.unavailableStoredSessionWords+=d.unavailableStoredSessionWords; m.storedSessionWords+=d.storedSessionWords??0;
    }
    return { schemaVersion:1, completion:invalid.sessionRows||invalid.dailyRows ? "complete_read_incomplete_reconciliation" : "complete", source, scope:{start:scope.start,end:scope.end,timezone:scope.timezone, range:"[start,end)", sessions:"All stored sessions scanned, including invalid/unlocatable and outside-range rows for trustworthy old-zone counterfactuals", daily:"All stored daily rows fingerprinted; reconciliation limited to calendar range"}, methods:contract, provenance, invalid,
      excludedFields:["items_read_count","highlights_count","top_source","matter_items.word_count"],
      daily, monthly:[...months.values()].map(m=>({...m,delta:diff(m.proposed,m.old),storedSessionWords:m.unavailableStoredSessionWords?null:m.storedSessionWords, explanation:m.unexplainedDays?{status:"unavailable",unavailableDays:m.unexplainedDays}: {status:"known_calendar_counterfactual",...m.explanation}, oldBaseline:"Sum of existing rows only; missing rollups remain unavailable", partialCalendarMonth:scope.start>`${m.month}-01` || scope.end<new Date(Date.UTC(Number(m.month.slice(0,4)),Number(m.month.slice(5,7)),1)).toISOString().slice(0,10)})) };
  }
  return {daily,session,finish};
}
export function fingerprint() {
  const hash=createHash("sha256"); let count=0;
  return { row(r) { hash.update(JSON.stringify(r)+"\n"); count++; }, finish() { return {rows:count,sha256:hash.digest("hex")}; } };
}
export function summarize(r) {
  const change=(old,proposed,delta,k)=>`${old?.[k]??"unavailable"} → ${proposed[k]} (${delta?.[k]??"unavailable"})`;
  return [`Historical repair PREVIEW: ${r.completion}`, `${r.scope.start} ≤ local day < ${r.scope.end}; ${r.scope.timezone}`, `Snapshot ${r.source.snapshot}; as of ${r.source.asOf}`, `Invalid session rows: ${r.invalid.sessionRows}; invalid daily rows: ${r.invalid.dailyRows}. No writes.`,
    "Month | words old → new (delta) | seconds old → new (delta) | sessions old → new (delta) | missing | stale",
    ...r.monthly.map(m=>`${m.month} | ${change(m.old,m.proposed,m.delta,"words_read")} | ${change(m.old,m.proposed,m.delta,"reading_time_seconds")} | ${change(m.old,m.proposed,m.delta,"sessions_count")} | ${m.missingRollups} | ${m.staleDates}`),
    "Daily | stored session words | words old → new (delta) | seconds old → new (delta) | sessions old → new (delta) | explanation",
    ...r.daily.map(d=>`${d.date} | ${d.storedSessionWords??"unavailable"} | ${change(d.old,d.proposed,d.delta,"words_read")} | ${change(d.old,d.proposed,d.delta,"reading_time_seconds")} | ${change(d.old,d.proposed,d.delta,"sessions_count")} | ${d.explanation.status}`),
    "Monthly old values are existing-row subtotals; missing rollups are unavailable. New values exclude invalid source rows.",
    "Unknown old calendar/method explanations remain unavailable; residuals are counterfactuals, not causal proof. Unrelated rollup fields excluded."].join("\n")+"\n";
}
