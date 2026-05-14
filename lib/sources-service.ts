import {
  METRICS_PERIOD_PRESETS,
  resolveMetricsDateRange,
  type MetricsDateRange,
  type MetricsPeriodPreset,
} from "./metrics-service";
import type { MatterStatsSupabaseClient } from "./supabase-queries";

export const SOURCE_RANKING_SORT_KEYS = ["reading-time", "articles", "words", "highlights"] as const;

export type SourceRankingSortKey = (typeof SOURCE_RANKING_SORT_KEYS)[number];

export type SourceRankingRow = {
  source: string;
  readingTimeSeconds: number;
  wordsRead: number;
  articlesRead: number;
  highlights: number;
  shareOfReading: number;
};

export type SourceRanking = {
  range: Omit<MetricsDateRange, "start" | "end"> & {
    start: string | null;
    end: string;
  };
  totals: {
    readingTimeSeconds: number;
    wordsRead: number;
    articlesRead: number;
    highlights: number;
  };
  sources: SourceRankingRow[];
};

export type GetSourceRankingOptions = {
  preset?: MetricsPeriodPreset;
  now?: Date | string;
  timezone?: string;
};

type SourceSessionItem = {
  id: string;
  source: string | null;
};

type SourceSession = {
  id: string;
  item_id: string;
  started_at: string | null;
  duration_seconds: number | null;
  words_estimated: number | null;
  matter_items: SourceSessionItem | SourceSessionItem[] | null;
};

type SourceAnnotation = {
  id: string;
  item_id: string;
  created_at_matter: string | null;
  matter_items: SourceSessionItem | SourceSessionItem[] | null;
};

type SourceAccumulator = {
  readingTimeSeconds: number;
  wordsRead: number;
  itemIds: Set<string>;
  highlightIds: Set<string>;
};

export function normalizeSourcePeriod(value: string | string[] | undefined, fallback: MetricsPeriodPreset = "month"): MetricsPeriodPreset {
  const candidate = Array.isArray(value) ? value[0] : value;
  return METRICS_PERIOD_PRESETS.includes(candidate as MetricsPeriodPreset) ? (candidate as MetricsPeriodPreset) : fallback;
}

export async function getSourceRanking(
  client: MatterStatsSupabaseClient,
  options: GetSourceRankingOptions = {},
): Promise<SourceRanking> {
  const range = resolveMetricsDateRange({
    preset: options.preset ?? "month",
    now: options.now,
    timezone: options.timezone,
  });
  const sessions = await fetchSourceSessions(client, range);
  const itemIds = [...new Set(sessions.map((session) => session.item_id).filter(isNonEmptyString))];
  const annotations = await fetchSourceAnnotations(client, range, itemIds);
  const buckets = bucketSourceSessions(sessions);

  for (const annotation of annotations) {
    const item = getJoinedItem(annotation.matter_items);
    const source = normalizeSourceName(item?.source);

    if (!source) {
      continue;
    }

    const bucket = getOrCreateBucket(buckets, source);
    bucket.highlightIds.add(annotation.id);
  }

  const totalReadingTimeSeconds = [...buckets.values()].reduce((total, bucket) => total + bucket.readingTimeSeconds, 0);
  const sources = [...buckets.entries()]
    .map(([source, bucket]) => ({
      source,
      readingTimeSeconds: bucket.readingTimeSeconds,
      wordsRead: bucket.wordsRead,
      articlesRead: bucket.itemIds.size,
      highlights: bucket.highlightIds.size,
      shareOfReading: totalReadingTimeSeconds > 0 ? bucket.readingTimeSeconds / totalReadingTimeSeconds : 0,
    }))
    .sort(compareSources("reading-time"));

  return {
    range: {
      ...range,
      start: range.start ? range.start.toISOString() : null,
      end: range.end.toISOString(),
    },
    totals: {
      readingTimeSeconds: totalReadingTimeSeconds,
      wordsRead: sources.reduce((total, source) => total + source.wordsRead, 0),
      articlesRead: new Set(sessions.map((session) => session.item_id).filter(isNonEmptyString)).size,
      highlights: sources.reduce((total, source) => total + source.highlights, 0),
    },
    sources,
  };
}

export function compareSources(sortKey: SourceRankingSortKey) {
  return (a: SourceRankingRow, b: SourceRankingRow): number => {
    switch (sortKey) {
      case "articles":
        return b.articlesRead - a.articlesRead || b.readingTimeSeconds - a.readingTimeSeconds || a.source.localeCompare(b.source);
      case "words":
        return b.wordsRead - a.wordsRead || b.readingTimeSeconds - a.readingTimeSeconds || a.source.localeCompare(b.source);
      case "highlights":
        return b.highlights - a.highlights || b.readingTimeSeconds - a.readingTimeSeconds || a.source.localeCompare(b.source);
      case "reading-time":
        return b.readingTimeSeconds - a.readingTimeSeconds || b.wordsRead - a.wordsRead || a.source.localeCompare(b.source);
      default: {
        const exhaustive: never = sortKey;
        return exhaustive;
      }
    }
  };
}

async function fetchSourceSessions(client: MatterStatsSupabaseClient, range: MetricsDateRange): Promise<SourceSession[]> {
  let query = client
    .from("reading_sessions")
    .select("id,item_id,started_at,duration_seconds,words_estimated,matter_items(id,source)")
    .lt("started_at", range.end.toISOString())
    .order("started_at", { ascending: false, nullsFirst: false });

  if (range.start) {
    query = query.gte("started_at", range.start.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as SourceSession[];
}

async function fetchSourceAnnotations(
  client: MatterStatsSupabaseClient,
  range: MetricsDateRange,
  itemIds: string[],
): Promise<SourceAnnotation[]> {
  if (itemIds.length === 0) {
    return [];
  }

  let query = client
    .from("annotations")
    .select("id,item_id,created_at_matter,matter_items(id,source)")
    .in("item_id", itemIds)
    .lt("created_at_matter", range.end.toISOString());

  if (range.start) {
    query = query.gte("created_at_matter", range.start.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as SourceAnnotation[];
}

function bucketSourceSessions(sessions: SourceSession[]): Map<string, SourceAccumulator> {
  const buckets = new Map<string, SourceAccumulator>();

  for (const session of sessions) {
    const item = getJoinedItem(session.matter_items);
    const source = normalizeSourceName(item?.source);

    if (!source) {
      continue;
    }

    const bucket = getOrCreateBucket(buckets, source);
    bucket.readingTimeSeconds += positiveInteger(session.duration_seconds);
    bucket.wordsRead += positiveInteger(session.words_estimated);
    bucket.itemIds.add(session.item_id);
  }

  return buckets;
}

function getOrCreateBucket(buckets: Map<string, SourceAccumulator>, source: string): SourceAccumulator {
  const existing = buckets.get(source);

  if (existing) {
    return existing;
  }

  const bucket = {
    readingTimeSeconds: 0,
    wordsRead: 0,
    itemIds: new Set<string>(),
    highlightIds: new Set<string>(),
  };
  buckets.set(source, bucket);
  return bucket;
}

function getJoinedItem(item: SourceSessionItem | SourceSessionItem[] | null): SourceSessionItem | null {
  return Array.isArray(item) ? (item[0] ?? null) : item;
}

function normalizeSourceName(source: string | null | undefined): string | null {
  const normalized = source?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function positiveInteger(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
