import { estimateWordsFromSeconds } from "./reading-estimates";
import type { TablesInsert } from "./supabase-types";

const READ_ITEM_STATUSES = new Set(["archive", "read", "completed"]);

type DailyStatsItem = { id: string; source: string | null; word_count: number | null; progress: number | null; status: string | null };
export type DailyStatsSession = { id?: string | null; item_id: string | null; duration_seconds: number | null; words_estimated: number | null; matter_items?: DailyStatsItem | DailyStatsItem[] | null };

export function buildDailyStat(date: string, sessions: DailyStatsSession[], highlightsCount: number): TablesInsert<"daily_stats"> {
  const sessionIds = new Set<string>();
  const itemIds = new Set<string>();
  const readItemIds = new Set<string>();
  const sourceSeconds = new Map<string, number>();
  const sourceSessions = new Map<string, number>();
  let readingTimeSeconds = 0;
  let wordsRead = 0;
  for (const session of sessions) {
    if (session.id) sessionIds.add(session.id);
    const item = getSessionItem(session);
    const itemId = session.item_id ?? item?.id ?? null;
    if (itemId) itemIds.add(itemId);
    if (itemId && isReadItem(item)) readItemIds.add(itemId);
    const durationSeconds = positiveInteger(session.duration_seconds);
    readingTimeSeconds += durationSeconds;
    wordsRead += estimateWordsFromSeconds(durationSeconds);
    const source = item?.source?.trim();
    if (source) {
      sourceSeconds.set(source, (sourceSeconds.get(source) ?? 0) + durationSeconds);
      sourceSessions.set(source, (sourceSessions.get(source) ?? 0) + 1);
    }
  }
  return { date, reading_time_seconds: readingTimeSeconds, words_read: wordsRead, sessions_count: sessionIds.size > 0 ? sessionIds.size : sessions.length, items_read_count: readItemIds.size > 0 ? readItemIds.size : itemIds.size, highlights_count: positiveInteger(highlightsCount), top_source: getTopSource(sourceSeconds, sourceSessions) };
}
function isReadItem(item: DailyStatsItem | null) { const status=item?.status?.trim().toLowerCase(); return !!item && ((status ? READ_ITEM_STATUSES.has(status) : false) || positiveProgress(item.progress) === 1); }
function getSessionItem(session: DailyStatsSession): DailyStatsItem | null { return Array.isArray(session.matter_items) ? session.matter_items[0] ?? null : session.matter_items ?? null; }
function getTopSource(seconds: Map<string,number>, counts: Map<string,number>): string | null { let top:null|string=null, topSeconds=-1, topCount=-1; for(const [source,value] of seconds){const count=counts.get(source)??0;if(value>topSeconds||(value===topSeconds&&count>topCount)||(value===topSeconds&&count===topCount&&(top===null||source.localeCompare(top)<0))){top=source;topSeconds=value;topCount=count;}} return top; }
function positiveInteger(value: number | null | undefined) { return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0; }
function positiveProgress(value: number | null | undefined) { return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value,0),1) : null; }
