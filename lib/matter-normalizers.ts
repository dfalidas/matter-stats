import type { MatterAnnotation, MatterItem, MatterReadingSession, MatterTag } from "./matter-api";
import type { Database } from "./supabase-types";

export const DEFAULT_READING_SPEED_WORDS_PER_MINUTE = 225;

export type MatterItemRow = Database["public"]["Tables"]["matter_items"]["Insert"];
export type ReadingSessionRow = Database["public"]["Tables"]["reading_sessions"]["Insert"];
export type MatterTagRow = Database["public"]["Tables"]["matter_tags"]["Insert"];
export type ItemTagRow = Database["public"]["Tables"]["item_tags"]["Insert"];
export type AnnotationRow = Database["public"]["Tables"]["annotations"]["Insert"];

export type NormalizableMatterItem = Partial<MatterItem> & Pick<MatterItem, "id">;
type NormalizableMatterTag = Partial<MatterTag> & Pick<MatterTag, "id">;
type NormalizableMatterAnnotation = Partial<MatterAnnotation> & Pick<MatterAnnotation, "id">;
type NormalizableMatterReadingSession = Partial<MatterReadingSession> & Pick<MatterReadingSession, "id">;

type JsonRecord = Record<string, unknown>;

type ReadingSessionWithOptionalApiFields = NormalizableMatterReadingSession & {
  itemId?: string | null;
  library_item_id?: string | null;
  libraryItemId?: string | null;
  target_id?: string | null;
  targetId?: string | null;
  item?: string | Partial<MatterItem> | null;
  library_item?: string | Partial<MatterItem> | null;
  libraryItem?: string | Partial<MatterItem> | null;
  target?: string | Partial<MatterItem> | null;
  started_at?: string | null;
  startedAt?: string | null;
  ended_at?: string | null;
  endedAt?: string | null;
  duration_seconds?: number | null;
  durationSeconds?: number | null;
  secondsRead?: number | null;
  source_device?: string | null;
  sourceDevice?: string | null;
  device?: string | null;
};

export type SafeReadingSessionShapeDiagnostics = {
  topLevelKeys: string[];
  hasItemLikeField: boolean;
  hasSessionId: boolean;
  hasDurationField: boolean;
  hasStartedAtField: boolean;
  hasEndedAtField: boolean;
};

export type NormalizeReadingSessionOptions = {
  item?: Pick<MatterItemRow, "word_count" | "progress"> | NormalizableMatterItem | null;
  readingSpeedWordsPerMinute?: number;
};

export type NormalizedItemTags = {
  matterTags: MatterTagRow[];
  itemTags: ItemTagRow[];
};

export function normalizeMatterItem(item: NormalizableMatterItem, syncedAt?: string): MatterItemRow {
  const wordCount = normalizeNonNegativeInteger(item.word_count);
  const progress = normalizeProgress(item.reading_progress, item.status);

  return {
    id: item.id,
    title: nullIfBlank(item.title),
    url: nullIfBlank(item.url),
    // Matter's site_name is the most user-facing source; the URL hostname is a stable fallback when site_name is missing.
    source: firstPresentText(item.site_name, getHostname(item.url)),
    // Author data is optional in Matter payloads, so keep this nullable rather than inventing a non-deterministic label.
    author: firstPresentText(item.author?.name),
    content_type: nullIfBlank(item.content_type),
    status: nullIfBlank(item.status),
    word_count: wordCount,
    // Reading time is derived only from word_count and the fixed default speed so repeated syncs produce the same value.
    estimated_reading_time_minutes: estimateReadingTimeMinutes(wordCount),
    progress,
    created_at_matter: normalizeIsoTimestamp(item.created_at),
    updated_at_matter: normalizeIsoTimestamp(item.updated_at),
    last_synced_at: normalizeIsoTimestamp(syncedAt),
  };
}

export function normalizeReadingSession(
  session: ReadingSessionWithOptionalApiFields,
  options: NormalizeReadingSessionOptions = {}
): ReadingSessionRow | null {
  const itemId = extractMatterReadingSessionItemId(session);
  if (!itemId) {
    return null;
  }

  const durationSeconds = normalizeNonNegativeInteger(
    session.duration_seconds ?? session.durationSeconds ?? session.seconds_read ?? session.secondsRead
  );
  const startedAt = normalizeIsoTimestamp(session.started_at ?? session.startedAt ?? session.date);
  const endedAt = normalizeSessionEndTimestamp(session.ended_at ?? session.endedAt, startedAt, durationSeconds);

  return {
    id: session.id,
    item_id: itemId,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    source_device: firstPresentText(session.source_device, session.sourceDevice, session.device),
    words_estimated: estimateWordsRead({
      durationSeconds,
      item: options.item ?? extractEmbeddedMatterItem(session),
      readingSpeedWordsPerMinute: options.readingSpeedWordsPerMinute,
    }),
  };
}

export function extractMatterReadingSessionItemId(session: unknown): string | null {
  if (!isRecord(session)) {
    return null;
  }

  return firstPresentText(
    textFromUnknown(session.item_id),
    textFromUnknown(session.itemId),
    textFromUnknown(session.library_item_id),
    textFromUnknown(session.libraryItemId),
    textFromUnknown(session.target_id),
    textFromUnknown(session.targetId),
    extractItemIdFromItemLike(session.item),
    extractItemIdFromItemLike(session.library_item),
    extractItemIdFromItemLike(session.libraryItem),
    extractItemIdFromItemLike(session.target)
  );
}

export function extractEmbeddedMatterItem(session: unknown): NormalizableMatterItem | null {
  if (!isRecord(session)) {
    return null;
  }

  for (const key of ["item", "library_item", "libraryItem", "target"]) {
    const value = session[key];
    if (isRecord(value) && isNonEmptyText(value.id)) {
      return value as NormalizableMatterItem;
    }
  }

  return null;
}

export function createPlaceholderMatterItem(itemId: string): NormalizableMatterItem {
  return {
    object: "item",
    id: itemId,
    title: "Unknown item",
    url: "",
    status: "queue",
    is_favorite: false,
    content_type: "article",
    reading_progress: 0,
    tags: [],
    updated_at: new Date(0).toISOString(),
  };
}

export function summarizeReadingSessionShape(session: unknown): SafeReadingSessionShapeDiagnostics | null {
  if (!isRecord(session)) {
    return null;
  }

  const keys = Object.keys(session).sort();
  return {
    topLevelKeys: keys,
    hasItemLikeField: [
      "item_id",
      "itemId",
      "item",
      "library_item_id",
      "libraryItemId",
      "library_item",
      "libraryItem",
      "target_id",
      "targetId",
      "target",
    ].some((key) => key in session),
    hasSessionId: isNonEmptyText(session.id),
    hasDurationField: ["duration_seconds", "durationSeconds", "seconds_read", "secondsRead"].some((key) => key in session),
    hasStartedAtField: ["started_at", "startedAt", "date"].some((key) => key in session),
    hasEndedAtField: ["ended_at", "endedAt"].some((key) => key in session),
  };
}

export function normalizeMatterTag(tag: NormalizableMatterTag): MatterTagRow {
  return {
    id: tag.id,
    // The database requires a tag name; using the Matter ID as the fallback is deterministic and preserves uniqueness.
    name: firstPresentText(tag.name, tag.id) ?? tag.id,
    created_at_matter: normalizeIsoTimestamp(tag.created_at),
    updated_at_matter: normalizeIsoTimestamp(tag.updated_at),
  };
}

export function normalizeMatterItemTags(item: Pick<NormalizableMatterItem, "id" | "tags">): NormalizedItemTags {
  const tags = item.tags ?? [];

  return {
    matterTags: tags.map((tag) => normalizeMatterTag(tag)),
    itemTags: tags.map((tag) => ({
      item_id: item.id,
      tag_id: tag.id,
    })),
  };
}

export function normalizeAnnotation(annotation: NormalizableMatterAnnotation): AnnotationRow | null {
  const itemId = nullIfBlank(annotation.item_id);
  if (!itemId) {
    return null;
  }

  return {
    id: annotation.id,
    item_id: itemId,
    text: nullIfBlank(annotation.text),
    note: nullIfBlank(annotation.note),
    created_at_matter: normalizeIsoTimestamp(annotation.created_at),
    updated_at_matter: normalizeIsoTimestamp(annotation.updated_at),
  };
}

function textFromUnknown(value: unknown): string | null {
  return isNonEmptyText(value) ? value : null;
}

function extractItemIdFromItemLike(value: unknown): string | null {
  if (isNonEmptyText(value)) {
    return value.trim();
  }

  if (isRecord(value)) {
    return firstPresentText(textFromUnknown(value.id));
  }

  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function estimateReadingTimeMinutes(wordCount: number | null): number | null {
  if (wordCount === null) {
    return null;
  }

  return Math.ceil(wordCount / DEFAULT_READING_SPEED_WORDS_PER_MINUTE);
}

function estimateWordsRead({
  durationSeconds,
  item,
  readingSpeedWordsPerMinute = DEFAULT_READING_SPEED_WORDS_PER_MINUTE,
}: {
  durationSeconds: number | null;
  item?: NormalizeReadingSessionOptions["item"];
  readingSpeedWordsPerMinute?: number;
}): number | null {
  const wordCount = normalizeNonNegativeInteger(item?.word_count);
  const progress = normalizeProgress(getItemProgress(item));

  if (wordCount !== null && progress !== null) {
    // Prefer Matter item facts when both are present: words read is the deterministic product of word_count and progress.
    return Math.round(wordCount * progress);
  }

  if (durationSeconds === null) {
    return null;
  }

  // If word_count/progress is unavailable, use elapsed time and a fixed WPM so estimates do not vary by environment.
  return Math.round((durationSeconds / 60) * readingSpeedWordsPerMinute);
}

function normalizeSessionEndTimestamp(endedAt: string | null | undefined, startedAt: string | null, durationSeconds: number | null): string | null {
  const explicitEndedAt = normalizeIsoTimestamp(endedAt);
  if (explicitEndedAt) {
    return explicitEndedAt;
  }

  if (!startedAt) {
    return null;
  }

  if (durationSeconds === null) {
    // Without a duration, use the start time as a zero-length session to satisfy ordering constraints deterministically.
    return startedAt;
  }

  return new Date(Date.parse(startedAt) + durationSeconds * 1_000).toISOString();
}

function normalizeProgress(progress: number | null | undefined, status?: string | null): number | null {
  if (typeof progress === "number" && Number.isFinite(progress)) {
    return clamp(progress, 0, 1);
  }

  // Archived items are treated as complete when Matter omits progress; other missing progress remains unknown.
  return status === "archive" ? 1 : null;
}

function getItemProgress(item: NormalizeReadingSessionOptions["item"]): number | null | undefined {
  if (!item) {
    return undefined;
  }

  if ("progress" in item) {
    return item.progress;
  }

  if ("reading_progress" in item) {
    return item.reading_progress;
  }

  return undefined;
}

function normalizeNonNegativeInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.round(value));
}

function normalizeIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function firstPresentText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = nullIfBlank(value);
    if (text !== null) {
      return text;
    }
  }

  return null;
}

function nullIfBlank(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getHostname(url: string | null | undefined): string | null {
  const text = nullIfBlank(url);
  if (!text) {
    return null;
  }

  try {
    return new URL(text).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
