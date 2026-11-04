import { createHash } from "node:crypto";
import { readCompleteSessions } from "./complete-session-query";
import { getOverviewReadingMetrics } from "./overview-service";
import { getActivityMonth } from "./activity-service";
import { getReadingReport, resolveReportRange, isValidReportReference } from "./reports-service";
import { formatReportCsv } from "./report-csv";
import type { MatterStatsSupabaseClient } from "./supabase-queries";
import { getDefaultMetricsTimezone } from "./metrics-service";

type Raw = { id: string; item_id: string | null; started_at: string | null; duration_seconds: number | null };
type Totals = { sessions: number; seconds: number; words: number; activeDays: number };
const timezone = "Europe/Athens";

/** Read-only, aggregate-only evidence. Independent requests do not share MVCC.
 * A changed fingerprint invalidates the comparison; an unchanged one cannot
 * exclude transient writes that were reverted between reads. */
export async function reconcileHistory(client: MatterStatsSupabaseClient, period: string, now = new Date()) {
  const kind = period.length === 4 ? "yearly" : "monthly";
  if (!isValidReportReference(kind, period) || getDefaultMetricsTimezone() !== timezone) throw new Error("Expected calendar period and Europe/Athens configuration");
  const range = resolveReportRange(kind, period, now, timezone);
  if (range.end > now) throw new Error("Reconcile complete historical periods only");
  const read = () => readCompleteSessions<Raw>(() => client.from("reading_sessions").select("id,item_id,started_at,duration_seconds"));
  const before = await read();
  const dated = before.filter(r => r.started_at && new Date(r.started_at) >= range.start && new Date(r.started_at) < range.end);
  const day = (timestamp: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
  const seconds = (r: Raw) => r.duration_seconds ?? 0;
  const expected: Totals = { sessions: dated.length, seconds: dated.reduce((n,r)=>n+seconds(r),0), words: dated.reduce((n,r)=>n+Math.round(seconds(r)*225/60),0), activeDays: new Set(dated.filter(r=>seconds(r)>0).map(r=>day(r.started_at!))).size };
  const first = day(range.start);
  const last = day(new Date(range.end.getTime()-1));
  const overview = (await getOverviewReadingMetrics(client,"month",first,last,now,timezone)).metrics;
  const report = (await getReadingReport(client,kind,{reference:period,now})).metrics;
  const activityDays = [];
  for (let m=1;m<= (kind === "yearly" ? 12 : 1);m++) {
    const month = kind === "yearly" ? `${period}-${String(m).padStart(2,"0")}` : period;
    activityDays.push(...(await getActivityMonth(client,month,null,1,now)).days);
  }
  const totals = (metrics: typeof report): Totals => ({ sessions: metrics.totals.sessionsCount, seconds: metrics.totals.totalReadingTimeSeconds, words: metrics.totals.wordsRead, activeDays: metrics.heatmap.filter(d=>d.readingTimeSeconds>0).length });
  const csv = formatReportCsv(report.heatmap).split("\n").slice(1).map(line=>line.split(",").slice(1).map(Number));
  const actuals: Record<string,Totals> = { Overview:totals(overview), Reports:totals(report), Activity:{ sessions:activityDays.reduce((n,d)=>n+d.sessions,0), seconds:activityDays.reduce((n,d)=>n+d.seconds,0), words:activityDays.reduce((n,d)=>n+d.estimatedWords,0), activeDays:activityDays.filter(d=>d.seconds>0).length }, CSV:{sessions:csv.reduce((n,r)=>n+r[2],0),seconds:csv.reduce((n,r)=>n+r[0],0),words:csv.reduce((n,r)=>n+r[1],0),activeDays:csv.filter(r=>r[0]>0).length} };
  const after = await read();
  const fingerprint = (rows:Raw[]) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const stable = fingerprint(before) === fingerprint(after);
  const comparisons = Object.entries(actuals).flatMap(([source,actual])=>(Object.keys(expected) as Array<keyof Totals>).map(metric=>({period,timezone,start:range.start.toISOString(),end:range.end.toISOString(),filters:"started_at >= start AND started_at < end; all linkage states",source,metric,expected:expected[metric],actual:actual[metric],difference:actual[metric]-expected[metric]})));
  return { status: !stable ? "inconclusive" : comparisons.some(r=>r.difference!==0) ? "mismatch" : "agree", consistency:"Live keyset reads; before/after fingerprint, not MVCC", coverage:"unverified; Task 26 completion and next incremental evidence required", linkage:{unlinked:dated.filter(r=>!r.item_id).length}, quality:{missingTimestamp:before.filter(r=>!r.started_at).length,nullDuration:before.filter(r=>r.duration_seconds===null).length}, comparisons };
}
