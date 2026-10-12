import { postgrestIn, quotePostgrest, readCompleteMetadata, readIdBatches } from "./complete-metadata-query";
import { readCompleteSessions } from "./complete-session-query";
import type { MatterItem, MatterTag, ReadingSession } from "@/lib/supabase-types";
import type { MatterStatsSupabaseClient } from "@/lib/supabase-queries";
import { METRICS_PERIOD_PRESETS, resolveMetricsDateRange, type MetricsPeriodPreset } from "./metrics-service";

export const ARTICLE_PAGE_SIZE = 100;
export const RELATED_ARTICLES_LIMIT = 5;

export type ArticleLibraryPeriod = MetricsPeriodPreset;

export type ArticleListFilters = {
  period?: ArticleLibraryPeriod;
  query?: string;
  source?: string;
  tag?: string;
  status?: string;
  author?: string;
  contentType?: string;
  size?: string;
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
  | "progress"
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
  filters: Required<Pick<ArticleListFilters, "period" | "query" | "source" | "tag" | "status" | "author" | "contentType" | "size" | "page">>;
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
  relatedArticles: RelatedArticle[];
  sourcePerformance: ArticleSourcePerformance | null;
};

export type RelatedArticle = Pick<
  MatterItem,
  "id" | "title" | "source" | "author" | "created_at_matter" | "updated_at_matter" | "estimated_reading_time_minutes"
>;

export type ArticleSourcePerformance = {
  source: string;
  sourceArticleCount: number;
  sourceAverageTimeSeconds: number;
  articleTimeSeconds: number;
  percentVsAverage: number | null;
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
  const status = filters.status?.trim() ?? "all";
  const author = filters.author?.trim() ?? "";
  const contentType = filters.contentType?.trim() ?? "";
  const size = filters.size?.trim() ?? "";
  const page = Math.max(filters.page ?? 1, 1);
  const range = resolveMetricsDateRange({ preset: period });
  const [sources, tags] = await Promise.all([
    fetchArticleSourceFacets(client),
    fetchArticleTagFacets(client),
  ]);

  let request = client
    .from("matter_items")
    .select(
      `id,title,url,source,author,status,word_count,estimated_reading_time_minutes,progress,created_at_matter,updated_at_matter${tag ? ",item_tags!inner(tag_id)" : ""}`,
      { count: "exact" },
    )
    .order("created_at_matter", { ascending: false, nullsFirst: false })
    .order("updated_at_matter", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true });

  if (range.start) {
    request = request.gte("created_at_matter", range.start.toISOString()).lt("created_at_matter", range.end.toISOString());
  }

  if (query) {
    const pattern = `%${escapeIlikePattern(query)}%`;
    request = request.or(`title.ilike.${quotePostgrest(pattern)},source.ilike.${quotePostgrest(pattern)},author.ilike.${quotePostgrest(pattern)}`);
  }

  if (source) {
    request = request.eq("source", source);
  }
  if (status && status !== "all") request = request.eq("status", status);
  if (author) request = request.eq("author", author);
  if (contentType) request = request.eq("content_type", contentType);
  if (size === "short") request = request.lt("word_count", 1500);
  if (size === "medium") request = request.gte("word_count", 1500).lt("word_count", 4000);
  if (size === "long") request = request.gte("word_count", 4000);

  if (tag) request = request.eq("item_tags.tag_id", tag);

  const from = (page - 1) * ARTICLE_PAGE_SIZE;
  const to = from + ARTICLE_PAGE_SIZE - 1;
  const { data, error, count } = await request.range(from, to);

  if (error) {
    throw error;
  }

  if (!Array.isArray(data) || count === null || !Number.isSafeInteger(count) || count < 0) throw new Error("Invalid Library page response");
  // The inner embed filters parents; it is not part of the public row contract.
  const rows = data.map((row) => {
    const { item_tags: relations, ...article } = row as unknown as ArticleListRow & { item_tags?: unknown };
    void relations;
    return article;
  });
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
    total: count,
    page,
    pageSize: ARTICLE_PAGE_SIZE,
    filters: { period, query, source, tag, status, author, contentType, size, page },
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

  const [tagsByItemId, annotations, sessionsResult, relatedArticles, sourcePerformance] = await Promise.all([
    fetchTagsByItemId(client, [id]),
    readCompleteMetadata<ArticleDetail["annotations"][number]>(() => client
      .from("annotations")
      .select("id,text,note,created_at_matter")
      .eq("item_id", id)
      .order("created_at_matter", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })),
    client
      .from("reading_sessions")
      .select("id,started_at,duration_seconds,words_estimated,source_device")
      .eq("item_id", id)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(25),
    fetchRelatedArticles(client, item),
    fetchSourcePerformance(client, item),
  ]);

  if (sessionsResult.error) {
    throw sessionsResult.error;
  }

  return {
    ...item,
    tags: tagsByItemId.get(id) ?? [],
    annotations,
    sessions: sessionsResult.data ?? [],
    relatedArticles,
    sourcePerformance,
  };
}

async function fetchArticleSourceFacets(client: MatterStatsSupabaseClient): Promise<ArticleFacet[]> {
  const data = await readCompleteMetadata<{ id: string; source: string | null }>(() => client.from("matter_items")
    .select("id,source").not("source", "is", null).order("source", { ascending: true }).order("id", { ascending: true }));

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
  const data = await readCompleteMetadata<Pick<MatterTag, "id" | "name">>(() => client.from("matter_tags")
    .select("id,name").order("name", { ascending: true }).order("id", { ascending: true }));

  return (data ?? []).map((tag) => ({ value: tag.id, label: tag.name }));
}

type JoinedTagRow = {
  item_id: string;
  tag_id: string;
  matter_tags: Pick<MatterTag, "id" | "name"> | Pick<MatterTag, "id" | "name">[] | null;
};

async function fetchTagsByItemId(client: MatterStatsSupabaseClient, itemIds: string[]): Promise<Map<string, Pick<MatterTag, "id" | "name">[]>> {
  const tagsByItemId = new Map<string, Pick<MatterTag, "id" | "name">[]>();

  if (itemIds.length === 0) {
    return tagsByItemId;
  }

  const data = await readIdBatches<JoinedTagRow>(itemIds, (ids) => readCompleteMetadata<JoinedTagRow>(() => client.from("item_tags")
    .select("item_id,tag_id,matter_tags(id,name)").filter("item_id", "in", postgrestIn(ids))
    .order("item_id", { ascending: true }).order("tag_id", { ascending: true }), ["item_id", "tag_id"]), ["item_id", "tag_id"]);

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

  const data = await readIdBatches<{ id: string; item_id: string }>(itemIds, (ids) => readCompleteMetadata<{ id: string; item_id: string }>(() => client.from("annotations")
    .select("id,item_id").filter("item_id", "in", postgrestIn(ids)).order("id", { ascending: true })));

  for (const row of data ?? []) {
    counts.set(row.item_id, (counts.get(row.item_id) ?? 0) + 1);
  }

  return counts;
}

async function fetchRelatedArticles(client: MatterStatsSupabaseClient, item: MatterItem): Promise<RelatedArticle[]> {
  const source = item.source?.trim();

  if (!source) {
    return [];
  }

  const { data, error } = await client
    .from("matter_items")
    .select("id,title,source,author,created_at_matter,updated_at_matter,estimated_reading_time_minutes")
    .eq("source", source)
    .neq("id", item.id)
    .order("created_at_matter", { ascending: false, nullsFirst: false })
    .order("updated_at_matter", { ascending: false, nullsFirst: false })
    .limit(RELATED_ARTICLES_LIMIT);

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function fetchSourcePerformance(client: MatterStatsSupabaseClient, item: MatterItem): Promise<ArticleSourcePerformance | null> {
  const source = item.source?.trim();

  if (!source) {
    return null;
  }

  const sourceItems = await readCompleteMetadata<{ id: string }>(() => client.from("matter_items")
    .select("id").eq("source", source).order("id", { ascending: true }));
  const sourceItemIds = sourceItems.map((sourceItem) => sourceItem.id);

  if (sourceItemIds.length === 0) {
    return {
      source,
      sourceArticleCount: 0,
      sourceAverageTimeSeconds: 0,
      articleTimeSeconds: 0,
      percentVsAverage: null,
    };
  }

  type SourceSession = { id: string; started_at: string | null; item_id: string | null; duration_seconds: number | null };
  const sourceSessions = await readIdBatches<SourceSession>(sourceItemIds, (ids) => readCompleteSessions<SourceSession>(
    () => client.from("reading_sessions").select("id,started_at,item_id,duration_seconds").filter("item_id", "in", postgrestIn(ids)),
  ));

  const timeByItemId = new Map<string, number>();
  for (const session of sourceSessions ?? []) {
    if (!session.item_id) {
      continue;
    }
    timeByItemId.set(session.item_id, (timeByItemId.get(session.item_id) ?? 0) + (session.duration_seconds ?? 0));
  }

  const sourceTotalSeconds = [...timeByItemId.values()].reduce((total, seconds) => total + seconds, 0);
  const sourceAverageTimeSeconds = sourceItemIds.length > 0 ? Math.round(sourceTotalSeconds / sourceItemIds.length) : 0;
  const articleTimeSeconds = timeByItemId.get(item.id) ?? 0;
  const percentVsAverage = sourceAverageTimeSeconds > 0 ? ((articleTimeSeconds - sourceAverageTimeSeconds) / sourceAverageTimeSeconds) * 100 : null;

  return {
    source,
    sourceArticleCount: sourceItemIds.length,
    sourceAverageTimeSeconds,
    articleTimeSeconds,
    percentVsAverage,
  };
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[%,]/g, "");
}
