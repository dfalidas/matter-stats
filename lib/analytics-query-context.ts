import { readCompleteSessions } from "./complete-session-query";
import { postgrestIn, readCompleteMetadata, readIdBatches } from "./complete-metadata-query";
import type { MatterStatsSupabaseClient } from "./supabase-queries";

export type AnalyticsSessionItem = {
  id: string;
  title: string | null;
  url: string | null;
  source: string | null;
  author: string | null;
  estimated_reading_time_minutes: number | null;
};
export type AnalyticsSession = {
  id: string;
  item_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  words_estimated: number | null;
  matter_items: AnalyticsSessionItem | AnalyticsSessionItem[] | null;
};
export type StreakSession = Pick<AnalyticsSession, "id" | "started_at" | "duration_seconds">;
type TagRow = { item_id: string; tag_id: string; matter_tags: { id: string; name: string } | { id: string; name: string }[] | null };
type Projection = "details" | "streak";
type Read = { start: number; end: number; projection: Projection; promise: Promise<AnalyticsSession[] | StreakSession[]> };

/** Owned by one service invocation, bound to one authorized caller's client.
 * There is no module cache. All filters/scope are fixed here except [start,end)
 * and the explicit projection; only a containing range with sufficient fields
 * is compatible. Never broadens a query to obtain reuse.
 */
export function createAnalyticsQueryContext(client: MatterStatsSupabaseClient) {
  const reads: Read[] = [];
  const tagReads: { ids: Set<string>; promise: Promise<Map<string, string[]>> }[] = [];

  function sessions(start: Date | null, end: Date, projection: "details"): Promise<AnalyticsSession[]>;
  function sessions(start: Date | null, end: Date, projection: "streak"): Promise<StreakSession[]>;
  function sessions(start: Date | null, end: Date, projection: Projection): Promise<AnalyticsSession[] | StreakSession[]> {
    const lower = start?.getTime() ?? -Infinity;
    const upper = end.getTime();
    const compatible = reads.find((read) => read.start <= lower && read.end >= upper
      && (read.projection === projection || read.projection === "details"));
    if (compatible) {
      if (compatible.start === lower && compatible.end === upper) return compatible.promise;
      return compatible.promise.then((rows) => rows.filter((row) => {
        if (!row.started_at) return false; // SQL date comparisons exclude NULL.
        const time = Date.parse(row.started_at);
        return time >= lower && time < upper;
      }));
    }
    const promise = readCompleteSessions<AnalyticsSession | StreakSession>(() => {
      let query = client.from("reading_sessions").select(projection === "details"
        ? "id,item_id,started_at,ended_at,duration_seconds,words_estimated,matter_items(id,title,url,source,author,estimated_reading_time_minutes)"
        : "id,started_at,duration_seconds").lt("started_at", end.toISOString());
      if (start) query = query.gte("started_at", start.toISOString());
      return query;
    });
    // Store the original promise, including its rejection. A failed read cannot
    // be retried as a successful empty/partial result within this request.
    reads.push({ start: lower, end: upper, projection, promise });
    return promise;
  }

  function tags(itemIds: string[]): Promise<Map<string, string[]>> {
    const ids = [...new Set(itemIds)].sort();
    if (!ids.length) return Promise.resolve(new Map());
    const compatible = tagReads.find((read) => ids.every((id) => read.ids.has(id)));
    if (compatible) return compatible.promise.then((map) => new Map(ids.map((id) => [id, map.get(id) ?? []])));
    const promise = readIdBatches<TagRow>(ids, (batch) => readCompleteMetadata<TagRow>(() => client.from("item_tags")
      .select("item_id,tag_id,matter_tags(id,name)").filter("item_id", "in", postgrestIn(batch))
      .order("item_id", { ascending: true }).order("tag_id", { ascending: true }), ["item_id", "tag_id"]), ["item_id", "tag_id"])
      .then((rows) => {
        const map = new Map<string, string[]>(ids.map((id) => [id, []]));
        for (const row of rows) {
          const tags = Array.isArray(row.matter_tags) ? row.matter_tags : row.matter_tags ? [row.matter_tags] : [];
          const names = tags.map((tag) => tag.name?.trim()).filter((name): name is string => !!name);
          map.set(row.item_id, [...(map.get(row.item_id) ?? []), ...names]);
        }
        return map;
      });
    tagReads.push({ ids: new Set(ids), promise });
    return promise;
  }

  return { sessions, tags, assertClient(candidate: MatterStatsSupabaseClient) {
    if (candidate !== client) throw new Error("Analytics query context belongs to a different client");
  } };
}
export type AnalyticsQueryContext = ReturnType<typeof createAnalyticsQueryContext>;
