import "server-only";

import { getServerEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Article, DashboardSummary, RankedStat, TrendPoint } from "@/lib/types/matter";
import type { Database } from "@/lib/supabase/database.types";

type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];

function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function toArticle(row: ArticleRow): Article {
  return {
    id: row.id,
    matterId: row.matter_id,
    title: row.title,
    url: row.url,
    source: row.source,
    author: row.author,
    wordCount: row.word_count ?? 0,
    readingTimeMinutes: row.reading_time_minutes ?? 0,
    status: row.status as Article["status"],
    readAt: row.read_at,
    createdAt: row.created_at,
    tags: row.tags ?? [],
  };
}

function rankByLabel(labels: Array<string | null | undefined>): RankedStat[] {
  const counts = new Map<string, number>();
  for (const label of labels) {
    if (label) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

function buildTrend(articles: Article[]): TrendPoint[] {
  const formatter = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" });
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (6 - index)));
    return {
      key: date.toISOString().slice(0, 10),
      label: formatter.format(date),
    };
  });

  return days.map((day) => {
    const dayArticles = articles.filter((article) => article.readAt?.slice(0, 10) === day.key);
    return {
      date: day.label,
      minutes: dayArticles.reduce((sum, article) => sum + article.readingTimeMinutes, 0),
      words: dayArticles.reduce((sum, article) => sum + article.wordCount, 0),
      articles: dayArticles.length,
    };
  });
}

function emptySummary(): DashboardSummary {
  return {
    metrics: [
      { label: "Reading time", value: "0m", delta: "Awaiting first sync" },
      { label: "Words read", value: "0", delta: "Awaiting first sync" },
      { label: "Articles read", value: "0", delta: "Awaiting first sync" },
      { label: "Avg session", value: "0m", delta: "Awaiting first sync" },
    ],
    trends: buildTrend([]),
    topSources: [],
    topAuthors: [],
    topTags: [],
    recentArticles: [],
    currentStreakDays: 0,
    bestStreakDays: 0,
  };
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const env = getServerEnv();

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return emptySummary();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("articles")
    .select("id,matter_id,title,url,source,author,word_count,reading_time_minutes,status,read_at,created_at,tags")
    .order("read_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) {
    throw new Error("Unable to load dashboard data from Supabase.");
  }

  const articles = (data ?? []).map(toArticle);
  const readArticles = articles.filter((article) => article.status === "read" || article.readAt);
  const totalMinutes = readArticles.reduce((sum, article) => sum + article.readingTimeMinutes, 0);
  const totalWords = readArticles.reduce((sum, article) => sum + article.wordCount, 0);
  const averageMinutes = readArticles.length > 0 ? Math.round(totalMinutes / readArticles.length) : 0;

  return {
    metrics: [
      { label: "Reading time", value: formatMinutes(totalMinutes), delta: "Synced from Supabase" },
      { label: "Words read", value: totalWords.toLocaleString(), delta: "Synced from Supabase" },
      { label: "Articles read", value: readArticles.length.toLocaleString(), delta: "Completed reads" },
      { label: "Avg session", value: formatMinutes(averageMinutes), delta: "Article-level estimate" },
    ],
    trends: buildTrend(readArticles),
    topSources: rankByLabel(readArticles.map((article) => article.source)),
    topAuthors: rankByLabel(readArticles.map((article) => article.author)),
    topTags: rankByLabel(readArticles.flatMap((article) => article.tags)),
    recentArticles: readArticles.slice(0, 8),
    currentStreakDays: 0,
    bestStreakDays: 0,
  };
}
