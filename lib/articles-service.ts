import type { MatterItem, MatterTag, ReadingSession } from "@/lib/supabase-types";
import type { MatterStatsSupabaseClient } from "@/lib/supabase-queries";
import { METRICS_PERIOD_PRESETS, resolveMetricsDateRange, type MetricsPeriodPreset } from "@/lib/metrics-service";

export const ARTICLE_PAGE_SIZE = 100;

export type ArticleLibraryPeriod = MetricsPeriodPreset;

export type ArticleListFilters = {
  period?: ArticleLibraryPeriod;
  query?: string;
  source?: string;
  tag?: string;
  page?: number;
};

export type ArticleListRow = Pick<
  MatterItem,
  | "id"
  | "title"
  | "url"
  | "source"
  | "author"
  | "status"
  | "word_count"
  | "estimated_reading_time_minutes"
  | "created_at_matter"
  | "updated_at_matter"
> & {
  highlights: number;
  tags: Pick<MatterTag, "id" | "name">[];
};

export type ArticleFacet = {
  value: string;
  label: string;
  count?: number;
};

export type ArticleListResult = {
  articles: ArticleListRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: Required<Pick<ArticleListFilters, "period" | "query" | "source" | "tag" | "page">>;
  sources: ArticleFacet[];
  tags: ArticleFacet[];
};

export type ArticleDetail = MatterItem & {
  tags: Pick<MatterTag, "id" | "name">[];
  annotations: {
    id: string;
    text: string | null;
    note: string | null;
    created_at_matter: string | null;
  }[];
  sessions: Pick<ReadingSession, "id" | "started_at" | "duration_seconds" | "words_estimated" | "source_device">[];
};

export function normalizeArticlePeriod(value: string | string[] | undefined, fallback: ArticleLibraryPeriod = "all-time"): ArticleLibraryPeriod {
  const candidate = Array.isArray(value) ? value[0] : value;
  return METRICS_PERIOD_PRESETS.includes(candidate as MetricsPeriodPreset) ? (candidate as ArticleLibraryPeriod) : fallback;
}

export function normalizeArticlePage(value: string | string[] | undefined): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(candidate ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export function normalizeArticleTextFilter(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim().slice(0, 120) ?? "";
}

export async function getArticleList(
  client: MatterStatsSupabaseClient,
  filters: ArticleListFilters = {},
): Promise<ArticleListResult> {
  const period = filters.period ?? "all-time";
  const query = filters.query?.trim() ?? "";
  const source = filters.source?.trim() ?? "";
  const tag = filters.tag?.trim() ?? "";
  const page = Math.max(filters.page ?? 1, 1);
  const range = resolveMetricsDateRange({ preset: period });
  const [sources, tags, tagItemIds] = await Promise.all([
    fetchArticleSourceFacets(client),
    fetchArticleTagFacets(client),
    tag ? fetchItemIdsForTag(client, tag) : Promise.resolve<string[] | null>(null),
  ]);

  if (tag && tagItemIds?.length === 0) {
    return {
      articles: [],
      total: 0,
      page,
      pageSize: ARTICLE_PAGE_SIZE,
      filters: { period, query, source, tag, page },
      sources,
      tags,
    };
  }

  let request = client
    .from("matter_items")
    .select(
      "id,title,url,source,author,status,word_count,estimated_reading_time_minutes,created_at_matter,updated_at_matter",
      { count: "exact" },
    )
    .order("created_at_matter", { ascending: false, nullsFirst: false })
    .order("updated_at_matter", { ascending: false, nullsFirst: false });

  if (range.start) {
    request = request.gte("created_at_matter", range.start.toISOString()).lt("created_at_matter", range.end.toISOString());
  }

  if (query) {
    const pattern = `%${escapeIlikePattern(query)}%`;
    request = request.or(`title.ilike.${pattern},source.ilike.${pattern},author.ilike.${pattern}`);
  }

  if (source) {
    request = request.eq("source", source);
  }

  if (tagItemIds) {
    request = request.in("id", tagItemIds);
  }

  const from = (page - 1) * ARTICLE_PAGE_SIZE;
  const to = from + ARTICLE_PAGE_SIZE - 1;
  const { data, error, count } = await request.range(from, to);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as ArticleListRow[];
  const itemIds = rows.map((article) => article.id);
  const [highlightCounts, tagsByItemId] = await Promise.all([
    fetchHighlightCounts(client, itemIds),
    fetchTagsByItemId(client, itemIds),
  ]);

  return {
    articles: rows.map((article) => ({
      ...article,
      highlights: highlightCounts.get(article.id) ?? 0,
      tags: tagsByItemId.get(article.id) ?? [],
    })),
    total: count ?? rows.length,
    page,
    pageSize: ARTICLE_PAGE_SIZE,
    filters: { period, query, source, tag, page },
    sources,
    tags,
  };
}

export async function getArticleDetail(client: MatterStatsSupabaseClient, id: string): Promise<ArticleDetail | null> {
  const { data: item, error: itemError } = await client.from("matter_items").select("*").eq("id", id).maybeSingle();

  if (itemError) {
    throw itemError;
  }

  if (!item) {
    return null;
  }

  const [tagsByItemId, annotationsResult, sessionsResult] = await Promise.all([
    fetchTagsByItemId(client, [id]),
    client
      .from("annotations")
      .select("id,text,note,created_at_matter")
      .eq("item_id", id)
      .order("created_at_matter", { ascending: true, nullsFirst: false }),
    client
      .from("reading_sessions")
      .select("id,started_at,duration_seconds,words_estimated,source_device")
      .eq("item_id", id)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(25),
  ]);

  if (annotationsResult.error) {
    throw annotationsResult.error;
  }

  if (sessionsResult.error) {
    throw sessionsResult.error;
  }

  return {
    ...item,
    tags: tagsByItemId.get(id) ?? [],
    annotations: annotationsResult.data ?? [],
    sessions: sessionsResult.data ?? [],
  };
}

async function fetchArticleSourceFacets(client: MatterStatsSupabaseClient): Promise<ArticleFacet[]> {
  const { data, error } = await client.from("matter_items").select("source").not("source", "is", null).order("source", { ascending: true });

  if (error) {
    throw error;
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const source = row.source?.trim();
    if (source) {
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
  }

  return [...counts.entries()].map(([value, count]) => ({ value, label: value, count }));
}

async function fetchArticleTagFacets(client: MatterStatsSupabaseClient): Promise<ArticleFacet[]> {
  const { data, error } = await client.from("matter_tags").select("id,name").order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((tag) => ({ value: tag.id, label: tag.name }));
}

async function fetchItemIdsForTag(client: MatterStatsSupabaseClient, tagId: string): Promise<string[]> {
  const { data, error } = await client.from("item_tags").select("item_id").eq("tag_id", tagId);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => row.item_id);
}

type JoinedTagRow = {
  item_id: string;
  matter_tags: Pick<MatterTag, "id" | "name"> | Pick<MatterTag, "id" | "name">[] | null;
};

async function fetchTagsByItemId(client: MatterStatsSupabaseClient, itemIds: string[]): Promise<Map<string, Pick<MatterTag, "id" | "name">[]>> {
  const tagsByItemId = new Map<string, Pick<MatterTag, "id" | "name">[]>();

  if (itemIds.length === 0) {
    return tagsByItemId;
  }

  const { data, error } = await client.from("item_tags").select("item_id,matter_tags(id,name)").in("item_id", itemIds);

  if (error) {
    throw error;
  }

  for (const row of (data ?? []) as unknown as JoinedTagRow[]) {
    const joined = Array.isArray(row.matter_tags) ? row.matter_tags[0] : row.matter_tags;

    if (!joined?.name) {
      continue;
    }

    const tags = tagsByItemId.get(row.item_id) ?? [];
    tags.push({ id: joined.id, name: joined.name });
    tagsByItemId.set(row.item_id, tags);
  }

  return tagsByItemId;
}

async function fetchHighlightCounts(client: MatterStatsSupabaseClient, itemIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  if (itemIds.length === 0) {
    return counts;
  }

  const { data, error } = await client.from("annotations").select("item_id").in("item_id", itemIds);

  if (error) {
    throw error;
  }

  for (const row of data ?? []) {
    counts.set(row.item_id, (counts.get(row.item_id) ?? 0) + 1);
  }

  return counts;
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[%,]/g, "");
}
