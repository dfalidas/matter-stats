import {
  METRICS_PERIOD_PRESETS,
  resolveMetricsDateRange,
  type MetricsDateRange,
  type MetricsPeriodPreset,
} from "./metrics-service";
import type { MatterStatsSupabaseClient } from "./supabase-queries";

export const TAG_RANKING_SORT_KEYS = ["reading-time", "articles", "words", "highlights"] as const;

export type TagRankingSortKey = (typeof TAG_RANKING_SORT_KEYS)[number];

export type TagRankingRow = {
  tagId: string;
  tag: string;
  readingTimeSeconds: number;
  wordsRead: number;
  articlesRead: number;
  highlights: number;
  shareOfTaggedReading: number;
};

export type TagRanking = {
  range: Omit<MetricsDateRange, "start" | "end"> & {
    start: string | null;
    end: string;
  };
  totals: {
    readingTimeSeconds: number;
    wordsRead: number;
    articlesRead: number;
    highlights: number;
    tags: number;
  };
  tags: TagRankingRow[];
};

export type GetTagRankingOptions = {
  preset?: MetricsPeriodPreset;
  now?: Date | string;
  timezone?: string;
};

type TagSession = {
  id: string;
  item_id: string;
  started_at: string | null;
  duration_seconds: number | null;
  words_estimated: number | null;
};

type TagAnnotation = {
  id: string;
  item_id: string;
  created_at_matter: string | null;
};

type ItemTagJoin = {
  item_id: string;
  tag_id: string;
  matter_tags: TagRecord | TagRecord[] | null;
};

type TagRecord = {
  id: string;
  name: string;
};

type TagAccumulator = {
  tagId: string;
  tag: string;
  readingTimeSeconds: number;
  wordsRead: number;
  itemIds: Set<string>;
  highlightIds: Set<string>;
};

export function normalizeTagPeriod(value: string | string[] | undefined, fallback: MetricsPeriodPreset = "month"): MetricsPeriodPreset {
  const candidate = Array.isArray(value) ? value[0] : value;
  return METRICS_PERIOD_PRESETS.includes(candidate as MetricsPeriodPreset) ? (candidate as MetricsPeriodPreset) : fallback;
}

export async function getTagRanking(
  client: MatterStatsSupabaseClient,
  options: GetTagRankingOptions = {},
): Promise<TagRanking> {
  const range = resolveMetricsDateRange({
    preset: options.preset ?? "month",
    now: options.now,
    timezone: options.timezone,
  });
  const sessions = await fetchTagSessions(client, range);
  const itemIds = [...new Set(sessions.map((session) => session.item_id).filter(isNonEmptyString))];
  const [itemTags, annotations] = await Promise.all([
    fetchItemTags(client, itemIds),
    fetchTagAnnotations(client, range, itemIds),
  ]);
  const tagsByItemId = groupTagsByItemId(itemTags);
  const buckets = bucketTagSessions(sessions, tagsByItemId);

  for (const annotation of annotations) {
    const tags = tagsByItemId.get(annotation.item_id) ?? [];

    for (const tag of tags) {
      const bucket = getOrCreateTagBucket(buckets, tag);
      bucket.highlightIds.add(annotation.id);
    }
  }

  const taggedItemIds = new Set<string>();
  const totalTaggedReadingTimeSeconds = sessions.reduce((total, session) => {
    const tags = tagsByItemId.get(session.item_id) ?? [];

    if (tags.length === 0) {
      return total;
    }

    taggedItemIds.add(session.item_id);
    return total + positiveInteger(session.duration_seconds);
  }, 0);

  const tags = [...buckets.values()]
    .map((bucket) => ({
      tagId: bucket.tagId,
      tag: bucket.tag,
      readingTimeSeconds: bucket.readingTimeSeconds,
      wordsRead: bucket.wordsRead,
      articlesRead: bucket.itemIds.size,
      highlights: bucket.highlightIds.size,
      shareOfTaggedReading: totalTaggedReadingTimeSeconds > 0 ? bucket.readingTimeSeconds / totalTaggedReadingTimeSeconds : 0,
    }))
    .sort(compareTags("reading-time"));

  return {
    range: {
      ...range,
      start: range.start ? range.start.toISOString() : null,
      end: range.end.toISOString(),
    },
    totals: {
      readingTimeSeconds: totalTaggedReadingTimeSeconds,
      wordsRead: sessions.reduce((total, session) => {
        const tagsForItem = tagsByItemId.get(session.item_id) ?? [];
        return tagsForItem.length > 0 ? total + positiveInteger(session.words_estimated) : total;
      }, 0),
      articlesRead: taggedItemIds.size,
      highlights: annotations.filter((annotation) => (tagsByItemId.get(annotation.item_id) ?? []).length > 0).length,
      tags: tags.length,
    },
    tags,
  };
}

export function compareTags(sortKey: TagRankingSortKey) {
  return (a: TagRankingRow, b: TagRankingRow): number => {
    switch (sortKey) {
      case "articles":
        return b.articlesRead - a.articlesRead || b.readingTimeSeconds - a.readingTimeSeconds || a.tag.localeCompare(b.tag);
      case "words":
        return b.wordsRead - a.wordsRead || b.readingTimeSeconds - a.readingTimeSeconds || a.tag.localeCompare(b.tag);
      case "highlights":
        return b.highlights - a.highlights || b.readingTimeSeconds - a.readingTimeSeconds || a.tag.localeCompare(b.tag);
      case "reading-time":
        return b.readingTimeSeconds - a.readingTimeSeconds || b.wordsRead - a.wordsRead || a.tag.localeCompare(b.tag);
      default: {
        const exhaustive: never = sortKey;
        return exhaustive;
      }
    }
  };
}

export function normalizeTagName(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

async function fetchTagSessions(client: MatterStatsSupabaseClient, range: MetricsDateRange): Promise<TagSession[]> {
  let query = client
    .from("reading_sessions")
    .select("id,item_id,started_at,duration_seconds,words_estimated")
    .lt("started_at", range.end.toISOString())
    .order("started_at", { ascending: false, nullsFirst: false });

  if (range.start) {
    query = query.gte("started_at", range.start.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as TagSession[];
}

async function fetchItemTags(client: MatterStatsSupabaseClient, itemIds: string[]): Promise<ItemTagJoin[]> {
  if (itemIds.length === 0) {
    return [];
  }

  const { data, error } = await client
    .from("item_tags")
    .select("item_id,tag_id,matter_tags(id,name)")
    .in("item_id", itemIds);

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as ItemTagJoin[];
}

async function fetchTagAnnotations(
  client: MatterStatsSupabaseClient,
  range: MetricsDateRange,
  itemIds: string[],
): Promise<TagAnnotation[]> {
  if (itemIds.length === 0) {
    return [];
  }

  let query = client
    .from("annotations")
    .select("id,item_id,created_at_matter")
    .in("item_id", itemIds)
    .lt("created_at_matter", range.end.toISOString());

  if (range.start) {
    query = query.gte("created_at_matter", range.start.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as TagAnnotation[];
}

function groupTagsByItemId(itemTags: ItemTagJoin[]): Map<string, TagRecord[]> {
  const tagsByItemId = new Map<string, TagRecord[]>();

  for (const itemTag of itemTags) {
    const tag = getJoinedTag(itemTag.matter_tags);
    const tagName = normalizeTagName(tag?.name);

    if (!tagName) {
      continue;
    }

    const tags = tagsByItemId.get(itemTag.item_id) ?? [];
    tags.push({ id: tag?.id ?? itemTag.tag_id, name: tagName });
    tagsByItemId.set(itemTag.item_id, tags);
  }

  return tagsByItemId;
}

function bucketTagSessions(sessions: TagSession[], tagsByItemId: Map<string, TagRecord[]>): Map<string, TagAccumulator> {
  const buckets = new Map<string, TagAccumulator>();

  for (const session of sessions) {
    const tags = tagsByItemId.get(session.item_id) ?? [];
    const readingTimeSeconds = positiveInteger(session.duration_seconds);
    const wordsRead = positiveInteger(session.words_estimated);

    for (const tag of tags) {
      const bucket = getOrCreateTagBucket(buckets, tag);
      bucket.readingTimeSeconds += readingTimeSeconds;
      bucket.wordsRead += wordsRead;
      bucket.itemIds.add(session.item_id);
    }
  }

  return buckets;
}

function getOrCreateTagBucket(buckets: Map<string, TagAccumulator>, tag: TagRecord): TagAccumulator {
  const existing = buckets.get(tag.id);

  if (existing) {
    return existing;
  }

  const bucket = {
    tagId: tag.id,
    tag: tag.name,
    readingTimeSeconds: 0,
    wordsRead: 0,
    itemIds: new Set<string>(),
    highlightIds: new Set<string>(),
  };
  buckets.set(tag.id, bucket);
  return bucket;
}

function getJoinedTag(tag: TagRecord | TagRecord[] | null): TagRecord | null {
  return Array.isArray(tag) ? (tag[0] ?? null) : tag;
}

function positiveInteger(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
