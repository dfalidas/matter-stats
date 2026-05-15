import "server-only";

import {
  getMatterAccount,
  iterateMatterAnnotations,
  listMatterItems,
  listMatterReadingSessions,
  listMatterTags,
  MatterApiError,
  MatterRateLimitError,
  type MatterListResponse,
  type MatterTag,
} from "@/lib/matter-api";
import {
  createSyncRun,
  getLatestSuccessfulSyncCheckpoint,
  getMatterSyncState,
  getSupabaseAdminClient,
  updateSyncRun,
  upsertAnnotations,
  upsertItemTags,
  upsertMatterItems,
  upsertMatterSyncState,
  upsertMatterTags,
  upsertReadingSessions,
} from "@/lib/supabase-admin";
import { recalculateDailyStats } from "@/lib/daily-stats";
import type { SyncState, TablesInsert } from "@/lib/supabase-types";
import {
  normalizeAnnotation,
  normalizeMatterItem,
  normalizeMatterItemTags,
  normalizeMatterTag,
  normalizeReadingSession,
  type MatterItemRow,
} from "@/lib/matter-normalizers";
import {
  buildMatterSyncMessage,
  createEmptyMatterBatchCounts,
  buildMatterRateLimitMessage,
  buildRateLimitedMatterSyncState,
  getMatterSyncItemsLimit,
  getMatterSyncSessionsLimit,
  isMatterRateLimitActive,
  type MatterBatchCounts,
  type MatterSyncPhase,
} from "@/lib/matter-sync-progress";

const UPSERT_BATCH_SIZE = 100;
const OPTIONAL_MATTER_STATUSES = new Set([403, 404]);

type MutableMatterSyncState = Pick<
  SyncState,
  | "completed_checkpoint_timestamp"
  | "active_since_timestamp"
  | "active_phase"
  | "item_cursor"
  | "tag_cursor"
  | "session_cursor"
  | "next_checkpoint_timestamp"
  | "rate_limited_until"
>;

export type MatterSyncResult = {
  ok: boolean;
  message: string;
  syncRunId?: string;
  itemsSynced?: number;
  sessionsSynced?: number;
  annotationsSynced?: number;
  tagsSynced?: number;
  hasMore?: boolean;
  rateLimitedUntil?: string | null;
};

type SyncCheckpoint = {
  next: string | null;
};

export async function getMatterSyncAvailability(): Promise<{ rateLimitedUntil: string | null; message: string | null }> {
  const state = await getMatterSyncState();
  const rateLimitedUntil = state?.rate_limited_until ?? null;

  return {
    rateLimitedUntil,
    message: isMatterRateLimitActive(rateLimitedUntil) ? buildMatterRateLimitMessage(rateLimitedUntil) : null,
  };
}

export async function syncMatterData(): Promise<MatterSyncResult> {
  let syncRunId: string | null = null;
  let storedState: SyncState | null = null;

  try {
    const [loadedState, legacyCheckpoint] = await Promise.all([getMatterSyncState(), getLatestSuccessfulSyncCheckpoint()]);
    storedState = loadedState;

    if (isMatterRateLimitActive(storedState?.rate_limited_until)) {
      return {
        ok: false,
        message: buildMatterRateLimitMessage(storedState?.rate_limited_until ?? null),
        rateLimitedUntil: storedState?.rate_limited_until ?? null,
      };
    }

    const startedAt = new Date().toISOString();
    const syncRun = await createSyncRun({ status: "running", started_at: startedAt });
    syncRunId = syncRun.id;

    // Validate the configured Matter token before mutating local Matter-derived rows.
    await getMatterAccount();

    const batchState = startBatchState(storedState, legacyCheckpoint);
    const counts = createEmptyMatterBatchCounts();
    const affectedDates = new Set<string>();
    const checkpoint: SyncCheckpoint = { next: batchState.next_checkpoint_timestamp ?? batchState.active_since_timestamp };
    const hasMore = await importNextMatterBatch({ state: batchState, counts, affectedDates, checkpoint });

    const persistedState = buildPersistedSyncState(batchState, checkpoint.next, hasMore);

    await recalculateDailyStats({ affectedDates });

    const finishedRun = await updateSyncRun(syncRunId, {
      status: "success",
      finished_at: new Date().toISOString(),
      items_synced: counts.items,
      sessions_synced: counts.sessions,
      annotations_synced: counts.annotations,
      tags_synced: counts.tags,
      error_message: null,
      checkpoint_timestamp: persistedState.completed_checkpoint_timestamp ?? null,
    });

    await upsertMatterSyncState(persistedState);

    return {
      ok: true,
      message: buildMatterSyncMessage(counts, hasMore),
      syncRunId: finishedRun.id,
      itemsSynced: finishedRun.items_synced,
      sessionsSynced: finishedRun.sessions_synced,
      annotationsSynced: finishedRun.annotations_synced,
      tagsSynced: finishedRun.tags_synced,
      hasMore,
    };
  } catch (error) {
    const rateLimitedUntil = getRateLimitedUntil(error);
    const sanitizedError = sanitizeSyncError(error);

    if (rateLimitedUntil) {
      try {
        await upsertMatterSyncState(buildRateLimitedSyncState(storedState, rateLimitedUntil));
      } catch (stateError) {
        console.error("Matter sync rate-limit state update failed", { error: sanitizeLogError(stateError) });
      }
    }

    if (syncRunId) {
      try {
        await updateSyncRun(syncRunId, {
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: sanitizedError,
          checkpoint_timestamp: null,
        });
      } catch (updateError) {
        console.error("Matter sync run error update failed", { syncRunId, error: sanitizeLogError(updateError) });
      }
    }

    console.error("Matter sync failed", { syncRunId, error: sanitizeLogError(error) });

    if (rateLimitedUntil) {
      return {
        ok: false,
        message: buildMatterRateLimitMessage(rateLimitedUntil),
        syncRunId: syncRunId ?? undefined,
        rateLimitedUntil,
      };
    }

    return {
      ok: false,
      message: `Matter sync failed safely. ${sanitizedError} No sync checkpoint was advanced; click Sync again after fixing the issue.`,
      syncRunId: syncRunId ?? undefined,
    };
  }
}

async function importNextMatterBatch({
  state,
  counts,
  affectedDates,
  checkpoint,
}: {
  state: MutableMatterSyncState;
  counts: MatterBatchCounts;
  affectedDates: Set<string>;
  checkpoint: SyncCheckpoint;
}): Promise<boolean> {
  if (state.active_phase === "items") {
    const itemPage = await listMatterItems({
      status: "all",
      updatedSince: state.active_since_timestamp ?? undefined,
      cursor: state.item_cursor ?? undefined,
      limit: getMatterSyncItemsLimit(),
    });
    const itemRows = await importMatterItemPage(itemPage, affectedDates, checkpoint);
    counts.items += itemRows.itemCount;
    counts.tags += itemRows.tagCount;
    counts.annotations += itemRows.annotationCount;

    if (itemPage.has_more && itemPage.next_cursor) {
      state.item_cursor = itemPage.next_cursor;
      return true;
    }

    state.item_cursor = null;
    state.active_phase = "tags";
  }

  if (state.active_phase === "tags") {
    const tagPage = await listOptionalMatterTagsPage({
      updatedSince: state.active_since_timestamp ?? undefined,
      cursor: state.tag_cursor ?? undefined,
      limit: getMatterSyncItemsLimit(),
    });

    if (tagPage) {
      const tagRows = tagPage.results.map((tag) => {
        const tagRow = normalizeMatterTag(tag);
        advanceCheckpoint(checkpoint, tagRow.updated_at_matter);
        return tagRow;
      });
      await upsertInBatches(tagRows, upsertMatterTags);
      counts.tags += tagRows.length;

      if (tagPage.has_more && tagPage.next_cursor) {
        state.tag_cursor = tagPage.next_cursor;
        return true;
      }
    }

    state.tag_cursor = null;
    state.active_phase = "sessions";
  }

  if (state.active_phase === "sessions") {
    const sessionPage = await listMatterReadingSessions({
      since: state.active_since_timestamp ?? undefined,
      cursor: state.session_cursor ?? undefined,
      limit: getMatterSyncSessionsLimit(),
    });
    const sessionCount = await importMatterSessionPage(sessionPage, affectedDates, checkpoint);
    counts.sessions += sessionCount;

    if (sessionPage.has_more && sessionPage.next_cursor) {
      state.session_cursor = sessionPage.next_cursor;
      return true;
    }

    state.session_cursor = null;
    state.active_phase = "complete";
  }

  return false;
}

async function importMatterItemPage(
  itemPage: Awaited<ReturnType<typeof listMatterItems>>,
  affectedDates: Set<string>,
  checkpoint: SyncCheckpoint
): Promise<{ itemCount: number; tagCount: number; annotationCount: number }> {
  const syncedAt = new Date().toISOString();
  const itemRows: MatterItemRow[] = [];
  const tagRowsById = new Map<string, TablesInsert<"matter_tags">>();
  const itemTagRowsByKey = new Map<string, TablesInsert<"item_tags">>();
  const itemIds = new Set<string>();

  for (const item of itemPage.results) {
    const itemRow = normalizeMatterItem(item, syncedAt);
    itemRows.push(itemRow);
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

  for (const affectedDate of await getReadingSessionDatesForItems([...itemIds])) {
    affectedDates.add(affectedDate);
  }

  await upsertInBatches([...tagRowsById.values()], upsertMatterTags);
  await upsertInBatches(itemRows, upsertMatterItems);
  await replaceItemTags([...itemIds], [...itemTagRowsByKey.values()]);

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

  return {
    itemCount: itemRows.length,
    tagCount: tagRowsById.size,
    annotationCount: annotationRows.length,
  };
}

async function importMatterSessionPage(
  sessionPage: Awaited<ReturnType<typeof listMatterReadingSessions>>,
  affectedDates: Set<string>,
  checkpoint: SyncCheckpoint
): Promise<number> {
  const sessionRows: TablesInsert<"reading_sessions">[] = [];
  const matterItemLookup = new Map<string, MatterItemRow | null>();

  for (const session of sessionPage.results) {
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
  return sessionRows.length;
}

function startBatchState(storedState: SyncState | null, legacyCheckpoint: string | null): MutableMatterSyncState {
  const completedCheckpoint = storedState?.completed_checkpoint_timestamp ?? legacyCheckpoint;

  if (storedState && storedState.active_phase !== "complete") {
    return {
      completed_checkpoint_timestamp: completedCheckpoint,
      active_since_timestamp: storedState.active_since_timestamp ?? completedCheckpoint,
      active_phase: normalizePhase(storedState.active_phase),
      item_cursor: storedState.item_cursor,
      tag_cursor: storedState.tag_cursor,
      session_cursor: storedState.session_cursor,
      next_checkpoint_timestamp: storedState.next_checkpoint_timestamp ?? storedState.active_since_timestamp ?? completedCheckpoint,
      rate_limited_until: storedState.rate_limited_until,
    };
  }

  return {
    completed_checkpoint_timestamp: completedCheckpoint,
    active_since_timestamp: completedCheckpoint,
    active_phase: "items",
    item_cursor: null,
    tag_cursor: null,
    session_cursor: null,
    next_checkpoint_timestamp: completedCheckpoint,
    rate_limited_until: storedState?.rate_limited_until ?? null,
  };
}

function buildPersistedSyncState(state: MutableMatterSyncState, nextCheckpoint: string | null, hasMore: boolean): TablesInsert<"sync_state"> {
  if (!hasMore && state.active_phase === "complete") {
    return {
      id: "matter",
      completed_checkpoint_timestamp: nextCheckpoint,
      active_since_timestamp: null,
      active_phase: "complete",
      item_cursor: null,
      tag_cursor: null,
      session_cursor: null,
      next_checkpoint_timestamp: null,
      rate_limited_until: null,
    };
  }

  return {
    id: "matter",
    completed_checkpoint_timestamp: state.completed_checkpoint_timestamp,
    active_since_timestamp: state.active_since_timestamp,
    active_phase: state.active_phase,
    item_cursor: state.item_cursor,
    tag_cursor: state.tag_cursor,
    session_cursor: state.session_cursor,
    next_checkpoint_timestamp: nextCheckpoint,
    rate_limited_until: null,
  };
}

function buildRateLimitedSyncState(storedState: SyncState | null, rateLimitedUntil: string): TablesInsert<"sync_state"> {
  return buildRateLimitedMatterSyncState(storedState, rateLimitedUntil);
}

function getRateLimitedUntil(error: unknown): string | null {
  if (!(error instanceof MatterRateLimitError)) {
    return null;
  }

  const retryAfterSeconds = error.rateLimit.retryAfterSeconds;
  if (retryAfterSeconds === null) {
    return null;
  }

  return new Date(Date.now() + retryAfterSeconds * 1_000).toISOString();
}

function normalizePhase(phase: string): MatterSyncPhase {
  if (phase === "items" || phase === "tags" || phase === "sessions" || phase === "complete") {
    return phase;
  }

  return "items";
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

async function listOptionalMatterTagsPage(params: Parameters<typeof listMatterTags>[0]): Promise<MatterListResponse<MatterTag> | null> {
  try {
    return await listMatterTags(params);
  } catch (error) {
    if (isOptionalMatterEndpointError(error)) {
      return null;
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

function sanitizeLogError(error: unknown): { name: string; message: string; status?: number; code?: string | null } {
  if (error instanceof MatterApiError) {
    return {
      name: error.name,
      message: sanitizeSyncError(error),
      status: error.status,
      code: error.code,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: "Matter sync failed because the local database update could not be completed.",
    };
  }

  return {
    name: "UnknownError",
    message: "Matter sync failed because the local database update could not be completed.",
  };
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
