import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, DailyStat, MatterItem, SyncRun } from "@/lib/supabase-types";
import { formatDateInTimezone, getDefaultMetricsTimezone } from "@/lib/metrics-service";
import { addCalendarDays } from "@/lib/calendar";

import { readDerivedDays, type DerivedGenerationContext } from "./derived-generation";

export type MatterStatsSupabaseClient = SupabaseClient<Database>;

export type DashboardSummary = {
  articlesRead: number;
  readingTimeSeconds: number;
  topSource: string | null;
  currentStreakDays: number;
};

export async function getDashboardSummary(client: MatterStatsSupabaseClient, now = new Date(), context?: DerivedGenerationContext): Promise<DashboardSummary> {
  const stats = await readDerivedDays(client, null, context);
  const topSource = [...stats].reverse().find((stat) => stat.top_source)?.top_source ?? null;

  return {
    articlesRead: stats.reduce((total, stat) => total + stat.items_read_count, 0),
    readingTimeSeconds: stats.reduce((total, stat) => total + stat.reading_time_seconds, 0),
    topSource,
    currentStreakDays: countCurrentStreak(stats, now),
  };
}

export async function getReadingTrend(client: MatterStatsSupabaseClient, days = 30, now = new Date(), context?: DerivedGenerationContext): Promise<DailyStat[]> {
  const today = formatDateInTimezone(now, getDefaultMetricsTimezone());
  const since = addCalendarDays(today, -Math.max(days - 1, 0));

  return readDerivedDays(client, since, context);
}

export async function getRecentMatterItems(client: MatterStatsSupabaseClient, limit = 10): Promise<MatterItem[]> {
  const { data, error } = await client
    .from("matter_items")
    .select("*")
    .order("updated_at_matter", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function getLatestSyncRun(client: MatterStatsSupabaseClient): Promise<SyncRun | null> {
  const { data, error } = await client.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

function countCurrentStreak(stats: Pick<DailyStat, "date" | "reading_time_seconds">[], now: Date): number {
  const activeDates = new Set(
    stats
      .filter((stat) => stat.reading_time_seconds > 0)
      .map((stat) => stat.date)
  );

  const timezone = getDefaultMetricsTimezone();
  let cursor = formatDateInTimezone(now, timezone);
  if (!activeDates.has(cursor)) {
    cursor = addCalendarDays(cursor, -1);
    if (!activeDates.has(cursor)) return 0;
  }

  let streak = 0;

  while (activeDates.has(cursor)) {
    streak += 1;
    cursor = addCalendarDays(cursor, -1);
  }

  return streak;
}
