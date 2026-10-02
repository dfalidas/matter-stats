import type { MatterStatsSupabaseClient } from "./supabase-queries";
import { estimateWordsFromSeconds } from "./reading-estimates";

export type ActivitySession={id:string;timestamp:string;durationSeconds:number;estimatedWords:number};
export async function getActivityMonth(client:MatterStatsSupabaseClient, month:string, selected:string|null, page=1){
 const valid=/^\d{4}-\d{2}$/.test(month)?month:new Date().toISOString().slice(0,7); const start=new Date(`${valid}-01T00:00:00Z`); const end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,1));
 const {data,error}=await client.from("reading_sessions").select("id,started_at,duration_seconds").gte("started_at",start.toISOString()).lt("started_at",end.toISOString()).order("started_at",{ascending:true}); if(error)throw error;
 const rows=data??[]; const days=new Map<string,{seconds:number;sessions:number}>(); for(const row of rows){if(!row.started_at)continue;const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(row.started_at));const old=days.get(day)??{seconds:0,sessions:0};old.seconds+=Math.max(0,row.duration_seconds??0);old.sessions++;days.set(day,old)}
 const day=selected&&/^\d{4}-\d{2}-\d{2}$/.test(selected)?selected:`${valid}-01`; const all=rows.filter(r=>r.started_at&&new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(r.started_at))===day); const pageSize=20;
 return {month:valid,selectedDay:day,days:[...days].map(([date,v])=>({date,...v,estimatedWords:estimateWordsFromSeconds(v.seconds)})),dayTotal:{seconds:all.reduce((n,r)=>n+Math.max(0,r.duration_seconds??0),0),sessions:all.length},sessions:all.slice((page-1)*pageSize,page*pageSize).map(r=>({id:r.id,timestamp:r.started_at!,durationSeconds:Math.max(0,r.duration_seconds??0),estimatedWords:estimateWordsFromSeconds(Math.max(0,r.duration_seconds??0))})),page,totalPages:Math.max(1,Math.ceil(all.length/pageSize))};
}
