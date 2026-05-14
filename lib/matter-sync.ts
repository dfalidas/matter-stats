import "server-only";

import { getMatterAccount, iterateMatterAnnotations, iterateMatterItems, iterateMatterReadingSessions, iterateMatterTags, MatterApiError } from "@/lib/matter-api";
import {
  createSyncRun,
  getLatestSuccessfulSyncCheckpoint,
  getSupabaseAdminClient,
  updateSyncRun,
  upsertAnnotations,
  upsertItemTags,
  upsertMatterItems,
  upsertMatterTags,
  upsertReadingSessions,
} from "@/lib/supabase-admin";
import type { TablesInsert } from "@/lib/supabase-types";
import {
  normalizeAnnotation,
  normalizeMatterItem,
  normalizeMatterItemTags,
  normalizeMatterTag,
  normalizeReadingSession,
  type MatterItemRow,
} from "@/lib/matter-normalizers";

const UPSERT_BATCH_SIZE = 100;
const OPTIONAL_MATTER_STATUSES = new Set([403, 404]);

export type MatterSyncResult = {
  ok: boolean;
  message: string;
  syncRunId?: string;
  itemsSynced?: number;
  sessionsSynced?: number;
};

type DailyStatsRecalculation = {
  affectedDates: Set<string>;
};

type SyncCheckpoint = {
  next: string | null;
};

export async function syncMatterData(): Promise<MatterSyncResult> {
  let syncRunId: string | null = null;

  try {
    const previousCheckpoint = await getLatestSuccessfulSyncCheckpoint();
    const startedAt = new Date().toISOString();
    const syncRun = await createSyncRun({ status: "running", started_at: startedAt });
    syncRunId = syncRun.id;

    // Validate the configured Matter token before mutating local Matter-derived rows.
    await getMatterAccount();

    const syncedAt = new Date().toISOString();
    const itemRows: MatterItemRow[] = [];
    const itemRowsById = new Map<string, MatterItemRow>();
    const tagRowsById = new Map<string, TablesInsert<"matter_tags">>();
    const itemTagRowsByKey = new Map<string, TablesInsert<"item_tags">>();
    const itemIds = new Set<string>();
    const checkpoint: SyncCheckpoint = { next: previousCheckpoint };

    for await (const item of iterateMatterItems({ status: "all", updatedSince: previousCheckpoint ?? undefined })) {
      const itemRow = normalizeMatterItem(item, syncedAt);
      itemRows.push(itemRow);
      itemRowsById.set(itemRow.id, itemRow);
      itemIds.add(itemRow.id);
      advanceCheckpoint(checkpoint, itemRow.updated_at_matter);

      const normalizedTags = normalizeMatterItemTags(item);
      for (const tagRow of normalizedTags.matterTags) {
        tagRowsById.set(tagRow.id, tagRow);
      }
      for (const itemTagRow of normalizedTags.itemTags) {
        itemTagRowsByKey.set(`${itemTagRow.item_id}:${itemTagRow.tag_id}`, itemTagRow);
      }
    }

    for await (const tag of iterateOptionalMatterTags({ updatedSince: previousCheckpoint ?? undefined })) {
      const tagRow = normalizeMatterTag(tag);
      tagRowsById.set(tagRow.id, tagRow);
      advanceCheckpoint(checkpoint, tagRow.updated_at_matter);
    }

    await upsertInBatches([...tagRowsById.values()], upsertMatterTags);
    await upsertInBatches(itemRows, upsertMatterItems);
    await replaceItemTags([...itemIds], [...itemTagRowsByKey.values()]);

    const sessionRows: TablesInsert<"reading_sessions">[] = [];
    const affectedDates = new Set<string>();

    for (const affectedDate of await getReadingSessionDatesForItems([...itemIds])) {
      affectedDates.add(affectedDate);
    }

    const matterItemLookup = new Map<string, MatterItemRow | null>(itemRowsById);

    for await (const session of iterateMatterReadingSessions({ since: previousCheckpoint ?? undefined })) {
      const sessionRow = normalizeReadingSession(session, {
        item: session.item_id ? await getMatterItemById(session.item_id, matterItemLookup) : null,
      });
      if (!sessionRow) {
        continue;
      }

      sessionRows.push(sessionRow);
      addDateFromTimestamp(affectedDates, sessionRow.started_at);
      advanceCheckpoint(checkpoint, sessionRow.started_at);
      advanceCheckpoint(checkpoint, sessionRow.ended_at);
    }

    await upsertInBatches(sessionRows, upsertReadingSessions);

    const annotationRows: TablesInsert<"annotations">[] = [];
    for (const itemId of itemIds) {
      for await (const annotation of iterateOptionalMatterAnnotations(itemId)) {
        const annotationRow = normalizeAnnotation(annotation);
        if (!annotationRow) {
          continue;
        }

        annotationRows.push(annotationRow);
        addDateFromTimestamp(affectedDates, annotationRow.created_at_matter);
        advanceCheckpoint(checkpoint, annotationRow.updated_at_matter);
      }
    }

    await upsertInBatches(annotationRows, upsertAnnotations);
    await recalculateDailyStats({ affectedDates });

    const finishedRun = await updateSyncRun(syncRunId, {
      status: "success",
      finished_at: new Date().toISOString(),
      items_synced: itemRows.length,
      sessions_synced: sessionRows.length,
      error_message: null,
      checkpoint_timestamp: checkpoint.next,
    });

    return {
      ok: true,
      message: `Sync complete: imported ${finishedRun.items_synced} items and ${finishedRun.sessions_synced} reading sessions.`,
      syncRunId: finishedRun.id,
      itemsSynced: finishedRun.items_synced,
      sessionsSynced: finishedRun.sessions_synced,
    };
  } catch (error) {
    const sanitizedError = sanitizeSyncError(error);

    if (syncRunId) {
      try {
        await updateSyncRun(syncRunId, {
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: sanitizedError,
        });
      } catch (updateError) {
        console.error("Matter sync run error update failed", { syncRunId, updateError });
      }
    }

    console.error("Matter sync failed", { syncRunId, error });

    return {
      ok: false,
      message: "Matter sync failed. Check the latest sync run for details.",
      syncRunId: syncRunId ?? undefined,
    };
  }
}

async function upsertInBatches<Row>(rows: Row[], upsert: (batch: Row[]) => Promise<unknown>) {
  for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
    await upsert(rows.slice(index, index + UPSERT_BATCH_SIZE));
  }
}

async function replaceItemTags(itemIds: string[], itemTags: TablesInsert<"item_tags">[]) {
  if (itemIds.length === 0) {
    return;
  }

  const client = getSupabaseAdminClient();
  for (let index = 0; index < itemIds.length; index += UPSERT_BATCH_SIZE) {
    const batch = itemIds.slice(index, index + UPSERT_BATCH_SIZE);
    const { error } = await client.from("item_tags").delete().in("item_id", batch);
    if (error) {
      throw error;
    }
  }

  await upsertInBatches(itemTags, upsertItemTags);
}

async function getReadingSessionDatesForItems(itemIds: string[]): Promise<string[]> {
  if (itemIds.length === 0) {
    return [];
  }

  const dates = new Set<string>();
  const client = getSupabaseAdminClient();

  for (let index = 0; index < itemIds.length; index += UPSERT_BATCH_SIZE) {
    const { data, error } = await client
      .from("reading_sessions")
      .select("started_at")
      .in("item_id", itemIds.slice(index, index + UPSERT_BATCH_SIZE));

    if (error) {
      throw error;
    }

    for (const session of data ?? []) {
      addDateFromTimestamp(dates, session.started_at);
    }
  }

  return [...dates];
}

async function getMatterItemById(itemId: string, cache: Map<string, MatterItemRow | null>): Promise<MatterItemRow | null> {
  if (cache.has(itemId)) {
    return cache.get(itemId) ?? null;
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("matter_items")
    .select("id, word_count, progress")
    .eq("id", itemId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const item = data ? { id: data.id, word_count: data.word_count, progress: data.progress } : null;
  cache.set(itemId, item);
  return item;
}

async function recalculateDailyStats({ affectedDates }: DailyStatsRecalculation) {
  if (affectedDates.size === 0) {
    return;
  }

  const stats: TablesInsert<"daily_stats">[] = [];
  for (const date of [...affectedDates].sort()) {
    stats.push(await calculateDailyStat(date));
  }

  await upsertInBatches(stats, async (batch) => {
    const { error } = await getSupabaseAdminClient().from("daily_stats").upsert(batch, { onConflict: "date" });
    if (error) {
      throw error;
    }
  });
}

async function calculateDailyStat(date: string): Promise<TablesInsert<"daily_stats">> {
  const client = getSupabaseAdminClient();
  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;

  const { data: sessions, error: sessionsError } = await client
    .from("reading_sessions")
    .select("item_id, duration_seconds, words_estimated")
    .gte("started_at", start)
    .lte("started_at", end);

  if (sessionsError) {
    throw sessionsError;
  }

  const sessionRows = sessions ?? [];
  const itemIds = [...new Set(sessionRows.map((session) => session.item_id).filter(Boolean))];
  const sourcesByItemId = new Map<string, string | null>();

  for (let index = 0; index < itemIds.length; index += UPSERT_BATCH_SIZE) {
    const { data: items, error: itemsError } = await client
      .from("matter_items")
      .select("id, source")
      .in("id", itemIds.slice(index, index + UPSERT_BATCH_SIZE));

    if (itemsError) {
      throw itemsError;
    }

    for (const item of items ?? []) {
      sourcesByItemId.set(item.id, item.source);
    }
  }

  const { count: highlightsCount, error: annotationsError } = await client
    .from("annotations")
    .select("id", { count: "exact", head: true })
    .gte("created_at_matter", start)
    .lte("created_at_matter", end);

  if (annotationsError) {
    throw annotationsError;
  }

  const sourceSeconds = new Map<string, number>();
  let readingTimeSeconds = 0;
  let wordsRead = 0;

  for (const session of sessionRows) {
    const durationSeconds = session.duration_seconds ?? 0;
    readingTimeSeconds += durationSeconds;
    wordsRead += session.words_estimated ?? 0;

    const source = sourcesByItemId.get(session.item_id);
    if (source) {
      sourceSeconds.set(source, (sourceSeconds.get(source) ?? 0) + durationSeconds);
    }
  }

  return {
    date,
    reading_time_seconds: readingTimeSeconds,
    words_read: wordsRead,
    sessions_count: sessionRows.length,
    items_read_count: itemIds.length,
    highlights_count: highlightsCount ?? 0,
    top_source: getTopSource(sourceSeconds),
  };
}

async function* iterateOptionalMatterTags(params: Parameters<typeof iterateMatterTags>[0] = {}) {
  try {
    yield* iterateMatterTags(params);
  } catch (error) {
    if (isOptionalMatterEndpointError(error)) {
      return;
    }
    throw error;
  }
}

async function* iterateOptionalMatterAnnotations(itemId: string) {
  try {
    yield* iterateMatterAnnotations(itemId);
  } catch (error) {
    if (isOptionalMatterEndpointError(error)) {
      return;
    }
    throw error;
  }
}

function isOptionalMatterEndpointError(error: unknown): boolean {
  return error instanceof MatterApiError && OPTIONAL_MATTER_STATUSES.has(error.status);
}

function sanitizeSyncError(error: unknown): string {
  if (error instanceof MatterApiError) {
    return `Matter API request failed during sync (status ${error.status}${error.code ? `, code ${error.code}` : ""}).`;
  }

  return "Matter sync failed because the local database update could not be completed.";
}

function addDateFromTimestamp(dates: Set<string>, timestamp: string | null | undefined) {
  if (!timestamp) {
    return;
  }

  const date = new Date(timestamp);
  if (Number.isFinite(date.getTime())) {
    dates.add(date.toISOString().slice(0, 10));
  }
}

function advanceCheckpoint(checkpoint: SyncCheckpoint, candidate: string | null | undefined) {
  checkpoint.next = maxIsoTimestamp(checkpoint.next, candidate);
}

function maxIsoTimestamp(current: string | null, candidate: string | null | undefined): string | null {
  if (!candidate) {
    return current;
  }

  if (!current || Date.parse(candidate) > Date.parse(current)) {
    return candidate;
  }

  return current;
}

function getTopSource(sourceSeconds: Map<string, number>): string | null {
  let topSource: string | null = null;
  let topSeconds = -1;

  for (const [source, seconds] of sourceSeconds) {
    if (seconds > topSeconds) {
      topSource = source;
      topSeconds = seconds;
    }
  }

  return topSource;
}
