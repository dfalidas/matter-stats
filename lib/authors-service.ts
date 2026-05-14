import {
  METRICS_PERIOD_PRESETS,
  resolveMetricsDateRange,
  type MetricsDateRange,
  type MetricsPeriodPreset,
} from "./metrics-service";
import type { MatterStatsSupabaseClient } from "./supabase-queries";

export const UNKNOWN_AUTHOR_LABEL = "Unknown author";
export const UNKNOWN_SOURCE_LABEL = "Unknown source";
export const AUTHOR_RANKING_SORT_KEYS = ["reading-time", "articles", "words", "top-source"] as const;

export type AuthorRankingSortKey = (typeof AUTHOR_RANKING_SORT_KEYS)[number];

export type AuthorRankingRow = {
  author: string;
  readingTimeSeconds: number;
  articlesRead: number;
  wordsRead: number;
  topSource: string;
};

export type AuthorRanking = {
  range: Omit<MetricsDateRange, "start" | "end"> & {
    start: string | null;
    end: string;
  };
  totals: {
    readingTimeSeconds: number;
    articlesRead: number;
    wordsRead: number;
    authors: number;
  };
  authors: AuthorRankingRow[];
};

export type GetAuthorRankingOptions = {
  preset?: MetricsPeriodPreset;
  now?: Date | string;
  timezone?: string;
};

type AuthorSessionItem = {
  id: string;
  author: string | null;
  source: string | null;
};

type AuthorSession = {
  id: string;
  item_id: string;
  started_at: string | null;
  duration_seconds: number | null;
  words_estimated: number | null;
  matter_items: AuthorSessionItem | AuthorSessionItem[] | null;
};

type SourceAccumulator = {
  readingTimeSeconds: number;
  wordsRead: number;
  itemIds: Set<string>;
};

type AuthorAccumulator = {
  readingTimeSeconds: number;
  wordsRead: number;
  itemIds: Set<string>;
  sources: Map<string, SourceAccumulator>;
};

export function normalizeAuthorPeriod(value: string | string[] | undefined, fallback: MetricsPeriodPreset = "month"): MetricsPeriodPreset {
  const candidate = Array.isArray(value) ? value[0] : value;
  return METRICS_PERIOD_PRESETS.includes(candidate as MetricsPeriodPreset) ? (candidate as MetricsPeriodPreset) : fallback;
}

export function normalizeAuthorName(author: string | null | undefined): string {
  const normalized = author?.trim();
  return normalized && normalized.length > 0 ? normalized : UNKNOWN_AUTHOR_LABEL;
}

export function normalizeAuthorSource(source: string | null | undefined): string {
  const normalized = source?.trim();
  return normalized && normalized.length > 0 ? normalized : UNKNOWN_SOURCE_LABEL;
}

export async function getAuthorRanking(
  client: MatterStatsSupabaseClient,
  options: GetAuthorRankingOptions = {},
): Promise<AuthorRanking> {
  const range = resolveMetricsDateRange({
    preset: options.preset ?? "month",
    now: options.now,
    timezone: options.timezone,
  });
  const sessions = await fetchAuthorSessions(client, range);
  const buckets = bucketAuthorSessions(sessions);
  const authors = [...buckets.entries()]
    .map(([author, bucket]) => ({
      author,
      readingTimeSeconds: bucket.readingTimeSeconds,
      articlesRead: bucket.itemIds.size,
      wordsRead: bucket.wordsRead,
      topSource: getTopSource(bucket.sources),
    }))
    .sort(compareAuthors("reading-time"));

  return {
    range: {
      ...range,
      start: range.start ? range.start.toISOString() : null,
      end: range.end.toISOString(),
    },
    totals: {
      readingTimeSeconds: authors.reduce((total, author) => total + author.readingTimeSeconds, 0),
      articlesRead: new Set(sessions.map((session) => session.item_id).filter(isNonEmptyString)).size,
      wordsRead: authors.reduce((total, author) => total + author.wordsRead, 0),
      authors: authors.length,
    },
    authors,
  };
}

export function compareAuthors(sortKey: AuthorRankingSortKey) {
  return (a: AuthorRankingRow, b: AuthorRankingRow): number => {
    switch (sortKey) {
      case "articles":
        return b.articlesRead - a.articlesRead || b.readingTimeSeconds - a.readingTimeSeconds || a.author.localeCompare(b.author);
      case "words":
        return b.wordsRead - a.wordsRead || b.readingTimeSeconds - a.readingTimeSeconds || a.author.localeCompare(b.author);
      case "top-source":
        return a.topSource.localeCompare(b.topSource) || b.readingTimeSeconds - a.readingTimeSeconds || a.author.localeCompare(b.author);
      case "reading-time":
        return b.readingTimeSeconds - a.readingTimeSeconds || b.wordsRead - a.wordsRead || a.author.localeCompare(b.author);
      default: {
        const exhaustive: never = sortKey;
        return exhaustive;
      }
    }
  };
}

async function fetchAuthorSessions(client: MatterStatsSupabaseClient, range: MetricsDateRange): Promise<AuthorSession[]> {
  let query = client
    .from("reading_sessions")
    .select("id,item_id,started_at,duration_seconds,words_estimated,matter_items(id,author,source)")
    .lt("started_at", range.end.toISOString())
    .order("started_at", { ascending: false, nullsFirst: false });

  if (range.start) {
    query = query.gte("started_at", range.start.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as AuthorSession[];
}

function bucketAuthorSessions(sessions: AuthorSession[]): Map<string, AuthorAccumulator> {
  const buckets = new Map<string, AuthorAccumulator>();

  for (const session of sessions) {
    const item = getJoinedItem(session.matter_items);
    const author = normalizeAuthorName(item?.author);
    const source = normalizeAuthorSource(item?.source);
    const readingTimeSeconds = positiveInteger(session.duration_seconds);
    const wordsRead = positiveInteger(session.words_estimated);
    const bucket = getOrCreateAuthorBucket(buckets, author);
    const sourceBucket = getOrCreateSourceBucket(bucket.sources, source);

    bucket.readingTimeSeconds += readingTimeSeconds;
    bucket.wordsRead += wordsRead;
    bucket.itemIds.add(session.item_id);

    sourceBucket.readingTimeSeconds += readingTimeSeconds;
    sourceBucket.wordsRead += wordsRead;
    sourceBucket.itemIds.add(session.item_id);
  }

  return buckets;
}

function getOrCreateAuthorBucket(buckets: Map<string, AuthorAccumulator>, author: string): AuthorAccumulator {
  const existing = buckets.get(author);

  if (existing) {
    return existing;
  }

  const bucket = {
    readingTimeSeconds: 0,
    wordsRead: 0,
    itemIds: new Set<string>(),
    sources: new Map<string, SourceAccumulator>(),
  };
  buckets.set(author, bucket);
  return bucket;
}

function getOrCreateSourceBucket(buckets: Map<string, SourceAccumulator>, source: string): SourceAccumulator {
  const existing = buckets.get(source);

  if (existing) {
    return existing;
  }

  const bucket = {
    readingTimeSeconds: 0,
    wordsRead: 0,
    itemIds: new Set<string>(),
  };
  buckets.set(source, bucket);
  return bucket;
}

function getTopSource(sources: Map<string, SourceAccumulator>): string {
  return (
    [...sources.entries()].sort(
      ([sourceA, a], [sourceB, b]) =>
        b.readingTimeSeconds - a.readingTimeSeconds || b.wordsRead - a.wordsRead || b.itemIds.size - a.itemIds.size || sourceA.localeCompare(sourceB),
    )[0]?.[0] ?? UNKNOWN_SOURCE_LABEL
  );
}

function getJoinedItem(item: AuthorSessionItem | AuthorSessionItem[] | null): AuthorSessionItem | null {
  return Array.isArray(item) ? (item[0] ?? null) : item;
}

function positiveInteger(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
