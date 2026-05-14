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
import { recalculateDailyStats } from "@/lib/daily-stats";
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

    for (const affectedDate of await getReadingSessionDatesForSessionIds(sessionRows.map((session) => session.id))) {
      affectedDates.add(affectedDate);
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

    for (const affectedDate of await getAnnotationDatesForAnnotationIds(annotationRows.map((annotation) => annotation.id))) {
      affectedDates.add(affectedDate);
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

async function getReadingSessionDatesForSessionIds(sessionIds: Array<string | undefined>): Promise<string[]> {
  const ids = sessionIds.filter(isNonEmptyString);
  if (ids.length === 0) {
    return [];
  }

  const dates = new Set<string>();
  const client = getSupabaseAdminClient();

  for (let index = 0; index < ids.length; index += UPSERT_BATCH_SIZE) {
    const { data, error } = await client
      .from("reading_sessions")
      .select("started_at")
      .in("id", ids.slice(index, index + UPSERT_BATCH_SIZE));

    if (error) {
      throw error;
    }

    for (const session of data ?? []) {
      addDateFromTimestamp(dates, session.started_at);
    }
  }

  return [...dates];
}

async function getAnnotationDatesForAnnotationIds(annotationIds: Array<string | undefined>): Promise<string[]> {
  const ids = annotationIds.filter(isNonEmptyString);
  if (ids.length === 0) {
    return [];
  }

  const dates = new Set<string>();
  const client = getSupabaseAdminClient();

  for (let index = 0; index < ids.length; index += UPSERT_BATCH_SIZE) {
    const { data, error } = await client
      .from("annotations")
      .select("created_at_matter")
      .in("id", ids.slice(index, index + UPSERT_BATCH_SIZE));

    if (error) {
      throw error;
    }

    for (const annotation of data ?? []) {
      addDateFromTimestamp(dates, annotation.created_at_matter);
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


function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
