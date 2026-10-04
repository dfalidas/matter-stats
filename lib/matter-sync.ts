import "server-only";

import {
  getMatterAccount,
  getMatterItem,
  iterateMatterAnnotations,
  listMatterItems,
  listMatterReadingSessions,
  logMatterApiError,
  MatterApiError,
  MatterRateLimitError,
  type MatterListResponse,
} from "@/lib/matter-api";
import {
  createSyncRun,
  getMatterSyncStream,
  getMatterSyncStreams,
  getMatterSyncState,
  getSupabaseAdminClient,
  updateSyncRun,
  upsertAnnotations,
  upsertItemTags,
  upsertMatterItems,
  upsertMatterSyncStream,
  upsertMatterTags,
  upsertReadingSessions,
} from "@/lib/supabase-admin";
import { recalculateDailyStats } from "@/lib/daily-stats";
import { getAppTimezone, timestampToCalendarDate } from "@/lib/calendar";
import type { Json, MatterSyncStream, TablesInsert } from "@/lib/supabase-types";
import {
  createPlaceholderMatterItem,
  extractEmbeddedMatterItem,
  extractMatterReadingSessionItemId,
  normalizeAnnotation,
  normalizeMatterItem,
  normalizeMatterItemTags,
  normalizeReadingSession,
  summarizeReadingSessionShape,
  type MatterItemRow,
  type NormalizableMatterItem,
} from "@/lib/matter-normalizers";
import {
  buildMatterSyncMessage,
  collectLinkedMatterItemIds,
  createEmptyMatterBatchCounts,
  buildMatterRateLimitMessage,
  getMatterSyncItemsLimit,
  getMatterSyncSessionsLimit,
  getRecentActivityWindowStart,
  isMatterRateLimitActive,
  matterPageHasMore,
  type MatterBatchCounts,
  type MatterRecentActivityWindow,
  type MatterSyncMode,
} from "@/lib/matter-sync-progress";

import {
  completeMatterCycle,
  persistActiveMatterCycle,
  startOrResumeMatterCycle,
  type ActiveMatterCycle,
} from "@/lib/matter-sync-cycle";

const UPSERT_BATCH_SIZE = 100;
const OPTIONAL_MATTER_STATUSES = new Set([403, 404]);

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

type MatterSyncDiagnostics = {
  requestCount: number;
  sessionsReturned: number;
  itemsReturned: number;
  lastHasMore: boolean;
  lastNextCursorPresent: boolean;
  sessionsSkipped: number;
  sessionsWithoutLinkedItem: number;
  firstSkipReason: string | null;
  firstSessionShape: Json | null;
};

export type MatterSyncRuntimeDeps = {
  now: () => Date;
  getStreams: typeof getMatterSyncStreams;
  getLegacyState: typeof getMatterSyncState;
  getStream: typeof getMatterSyncStream;
  upsertStream: typeof upsertMatterSyncStream;
  createRun: typeof createSyncRun;
  updateRun: typeof updateSyncRun;
  getAccount: typeof getMatterAccount;
  listSessions: typeof listMatterReadingSessions;
  listItems: typeof listMatterItems;
  recalculate: typeof recalculateDailyStats;
  importSessions: typeof importMatterSessionPage;
  importItems: typeof importMatterItemPage;
};

const productionSyncDeps: MatterSyncRuntimeDeps = {
  now: () => new Date(),
  getStreams: getMatterSyncStreams,
  getLegacyState: getMatterSyncState,
  getStream: getMatterSyncStream,
  upsertStream: upsertMatterSyncStream,
  createRun: createSyncRun,
  updateRun: updateSyncRun,
  getAccount: getMatterAccount,
  listSessions: listMatterReadingSessions,
  listItems: listMatterItems,
  recalculate: recalculateDailyStats,
  importSessions: importMatterSessionPage,
  importItems: importMatterItemPage,
};

function createEmptyMatterSyncDiagnostics(): MatterSyncDiagnostics {
  return {
    requestCount: 0,
    sessionsReturned: 0,
    itemsReturned: 0,
    lastHasMore: false,
    lastNextCursorPresent: false,
    sessionsSkipped: 0,
    sessionsWithoutLinkedItem: 0,
    firstSkipReason: null,
    firstSessionShape: null,
  };
}

function recordMatterPageDiagnostics(diagnostics: MatterSyncDiagnostics, page: MatterListResponse<unknown>) {
  diagnostics.lastHasMore = page.has_more;
  diagnostics.lastNextCursorPresent = page.next_cursor !== null && page.next_cursor.trim().length > 0;
}

export function getActiveMatterCooldown(
  states: MatterSyncStream[],
  legacyRateLimitedUntil: string | null | undefined,
  now: Date = new Date()
): string | null {
  const rateLimitedUntil = [...states.map((state) => state.retry_at), legacyRateLimitedUntil]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return isMatterRateLimitActive(rateLimitedUntil, now) ? rateLimitedUntil : null;
}

async function loadActiveMatterCooldown(deps: MatterSyncRuntimeDeps, now: Date = deps.now()): Promise<string | null> {
  const [states, legacy] = await Promise.all([deps.getStreams(), deps.getLegacyState()]);
  return getActiveMatterCooldown(states, legacy?.rate_limited_until, now);
}

export async function getMatterSyncAvailability(
  deps: MatterSyncRuntimeDeps = productionSyncDeps
): Promise<{ rateLimitedUntil: string | null; message: string | null }> {
  const rateLimitedUntil = await loadActiveMatterCooldown(deps);

  if (!rateLimitedUntil) {
    return { rateLimitedUntil: null, message: null };
  }

  return {
    rateLimitedUntil,
    message: buildMatterRateLimitMessage(rateLimitedUntil),
  };
}

export async function syncMatterData(
  mode: MatterSyncMode = "recent_activity_manual",
  options: { recentActivityWindow?: MatterRecentActivityWindow } = {},
  deps: MatterSyncRuntimeDeps = productionSyncDeps
): Promise<MatterSyncResult> {
  let syncRunId: string | null = null;
  let storedState: MatterSyncStream | null = null;
  let activeCycle: ActiveMatterCycle | null = null;

  try {
    const invocationNow = deps.now();
    const stream = mode === "backfill_library" ? "library_items" : "recent_sessions";
    const rateLimitedUntil = await loadActiveMatterCooldown(deps, invocationNow);
    if (rateLimitedUntil) {
      return {
        ok: false,
        message: buildMatterRateLimitMessage(rateLimitedUntil),
        rateLimitedUntil,
      };
    }
    storedState = await deps.getStream(stream);

    const requestedWindow = isRecentActivityMode(mode) ? options.recentActivityWindow : undefined;
    if (requestedWindow && storedState?.coverage_window && requestedWindow !== storedState.coverage_window) {
      return {
        ok: false,
        message: `The requested ${requestedWindow} history window differs from this stream's ${storedState.coverage_window} contract. Finish or explicitly restart that history operation before changing coverage.`,
      };
    }

    const startedAt = invocationNow.toISOString();
    const syncRun = await deps.createRun({ status: "running", started_at: startedAt, sync_mode: mode });
    syncRunId = syncRun.id;

    const recentActivitySince = isRecentActivityMode(mode) ? getRecentActivityWindowStart(new Date(startedAt), options.recentActivityWindow) : null;
    activeCycle = startOrResumeMatterCycle({
      stream,
      stored: storedState,
      now: new Date(startedAt),
      configuredLimit: stream === "recent_sessions" ? getMatterSyncSessionsLimit() : getMatterSyncItemsLimit(),
      initialSince: recentActivitySince,
      requestedWindow: requestedWindow ?? null,
    });
    // Persist the complete request contract before making any upstream call.
    await deps.upsertStream(persistActiveMatterCycle(activeCycle, activeCycle.cursor));
    await deps.getAccount();
    const counts = createEmptyMatterBatchCounts();
    const diagnostics = createEmptyMatterSyncDiagnostics();
    const affectedDates = new Set<string>();
    const checkpoint: SyncCheckpoint = { next: null };
    const nextCursor = await importNextMatterBatch({ cycle: activeCycle, counts, affectedDates, checkpoint, diagnostics, deps });
    const hasMore = nextCursor !== undefined;
    const persistedState = hasMore
      ? persistActiveMatterCycle(activeCycle, nextCursor ?? null)
      : completeMatterCycle(activeCycle);

    await deps.recalculate({ affectedDates });

    const finishedRun = await deps.updateRun(syncRunId, {
      status: "success",
      finished_at: new Date().toISOString(),
      items_synced: counts.items,
      sessions_synced: counts.sessions,
      annotations_synced: counts.annotations,
      tags_synced: counts.tags,
      sync_mode: mode,
      matter_requests_count: diagnostics.requestCount,
      matter_sessions_returned: diagnostics.sessionsReturned,
      matter_items_returned: diagnostics.itemsReturned,
      matter_sessions_skipped: diagnostics.sessionsSkipped,
      matter_sessions_without_linked_item: diagnostics.sessionsWithoutLinkedItem,
      matter_first_session_shape: diagnostics.firstSessionShape,
      matter_has_more: diagnostics.lastHasMore,
      matter_next_cursor_present: diagnostics.lastNextCursorPresent,
      error_message: null,
      checkpoint_timestamp: persistedState.completed_watermark ?? null,
    });

    await deps.upsertStream(persistedState);

    return {
      ok: true,
      message: buildMatterSyncMessage(counts, hasMore, mode, {
        sessionsReturned: diagnostics.sessionsReturned,
        sessionsSkipped: diagnostics.sessionsSkipped,
        sessionsWithoutLinkedItem: diagnostics.sessionsWithoutLinkedItem,
      }),
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
        if (activeCycle) {
          await deps.upsertStream(persistActiveMatterCycle(activeCycle, activeCycle.cursor, rateLimitedUntil));
        }
      } catch (stateError) {
        console.error("Matter sync rate-limit state update failed", { error: sanitizeLogError(stateError) });
      }
    }

    if (syncRunId) {
      try {
        await deps.updateRun(syncRunId, {
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: sanitizedError,
          sync_mode: mode,
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
  cycle,
  counts,
  affectedDates,
  checkpoint,
  diagnostics,
  deps,
}: {
  cycle: ActiveMatterCycle;
  counts: MatterBatchCounts;
  affectedDates: Set<string>;
  checkpoint: SyncCheckpoint;
  diagnostics: MatterSyncDiagnostics;
  deps: MatterSyncRuntimeDeps;
}): Promise<string | null | undefined> {
  diagnostics.requestCount += 1;

  if (cycle.stream === "library_items") {
    const itemPage = await deps.listItems({
      status: cycle.filters.status === "all" ? "all" : undefined,
      order: cycle.filters.order === "updated" ? "updated" : undefined,
      updatedSince: cycle.filters.updated_since,
      cursor: cycle.cursor ?? undefined,
      limit: cycle.pageLimit,
    });
    diagnostics.itemsReturned += itemPage.results.length;
    recordMatterPageDiagnostics(diagnostics, itemPage);
    const imported = await deps.importItems(itemPage, affectedDates, checkpoint);
    counts.items += imported.itemCount;
    counts.tags += imported.tagCount;
    counts.annotations += imported.annotationCount;
    return matterPageHasMore(itemPage) ? requireNextCursor(itemPage.next_cursor) : undefined;
  }

  const sessionPage = await deps.listSessions({
    since: cycle.filters.since,
    cursor: cycle.cursor ?? undefined,
    limit: cycle.pageLimit,
  });
  diagnostics.sessionsReturned += sessionPage.results.length;
  recordMatterPageDiagnostics(diagnostics, sessionPage);
  const imported = await deps.importSessions(sessionPage, affectedDates, checkpoint, diagnostics);
  counts.sessions += imported.sessions;
  counts.items += imported.items;
  counts.tags += imported.tags;
  counts.annotations += imported.annotations;
  return matterPageHasMore(sessionPage) ? requireNextCursor(sessionPage.next_cursor) : undefined;
}

function requireNextCursor(cursor: string | null): string {
  if (!cursor?.trim()) throw new Error("Matter reported more pages without an opaque next cursor.");
  return cursor;
}

async function importMatterItemPage(
  itemPage: MatterListResponse<NormalizableMatterItem>,
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
  checkpoint: SyncCheckpoint,
  diagnostics: MatterSyncDiagnostics
): Promise<{ sessions: number; items: number; tags: number; annotations: number }> {
  let firstSkippedSession: unknown = null;

  const embeddedItems = sessionPage.results.map(extractEmbeddedMatterItem).filter((item): item is NonNullable<typeof item> => item !== null);
  const linkedItemIds = collectLinkedMatterItemIds(sessionPage.results);
  const linkedItemCounts = await importLinkedMatterItems(linkedItemIds, embeddedItems, affectedDates, checkpoint, diagnostics);
  const sessionRows: TablesInsert<"reading_sessions">[] = [];
  const matterItemLookup = new Map<string, MatterItemRow | null>();

  for (const session of sessionPage.results) {
    const itemId = extractMatterReadingSessionItemId(session);
    const skipReason = classifySessionSkipReason(session);
    if (skipReason) {
      diagnostics.sessionsSkipped += 1;
      if (diagnostics.firstSkipReason === null) {
        diagnostics.firstSkipReason = skipReason;
        firstSkippedSession = session;
      }
      continue;
    }
    if (!itemId) {
      diagnostics.sessionsWithoutLinkedItem += 1;
    }
    const sessionRow = normalizeReadingSession(session, {
      item: itemId ? await getMatterItemById(itemId, matterItemLookup) : extractEmbeddedMatterItem(session),
    });
    if (!sessionRow) {
      diagnostics.sessionsSkipped += 1;
      if (diagnostics.firstSkipReason === null) {
        diagnostics.firstSkipReason = "database_upsert_error";
        firstSkippedSession = session;
      }
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

  if (sessionPage.results.length > 0 && diagnostics.firstSessionShape === null) {
    diagnostics.firstSessionShape = summarizeReadingSessionShapeWithSkip(sessionPage.results[0], diagnostics.firstSkipReason, firstSkippedSession) as Json;
  } else if (diagnostics.firstSessionShape && diagnostics.firstSkipReason) {
    diagnostics.firstSessionShape = {
      ...(diagnostics.firstSessionShape as Record<string, unknown>),
      skipReason: diagnostics.firstSkipReason,
    } as Json;
  }

  try {
    await upsertInBatches(sessionRows, upsertReadingSessions);
  } catch (error) {
    diagnostics.firstSkipReason ??= "database_upsert_error";
    throw error;
  }
  return { sessions: sessionRows.length, items: linkedItemCounts.itemCount, tags: linkedItemCounts.tagCount, annotations: linkedItemCounts.annotationCount };
}

function classifySessionSkipReason(session: unknown): string | null {
  const sessionId = typeof (session as { id?: unknown })?.id === "string" ? (session as { id?: string }).id : null;
  if (!isNonEmptyString(sessionId)) {
    return "missing_session_id";
  }
  const startedAt = normalizeReadingSession(session as Parameters<typeof normalizeReadingSession>[0])?.started_at;
  if (!startedAt) {
    return "invalid_date";
  }
  const duration = normalizeReadingSession(session as Parameters<typeof normalizeReadingSession>[0])?.duration_seconds;
  if (duration === null || duration === undefined) {
    return "invalid_seconds_read";
  }
  return null;
}

function summarizeReadingSessionShapeWithSkip(session: unknown, skipReason: string | null, skippedSession: unknown): Record<string, unknown> | null {
  const summary = summarizeReadingSessionShape(session) as Record<string, unknown> | null;
  if (!summary || typeof session !== "object" || session === null || Array.isArray(session)) {
    return summary;
  }
  const first = session as Record<string, unknown>;
  const objectValue = first.object;
  const objectText = typeof objectValue === "string" ? objectValue : null;
  const skipTarget = typeof skippedSession === "object" && skippedSession !== null && !Array.isArray(skippedSession)
    ? (skippedSession as Record<string, unknown>)
    : null;
  return {
    ...summary,
    objectType: typeof objectValue,
    objectLooksLikeItemId: typeof objectText === "string" && objectText.trim().length > 0 && objectText !== "reading_session",
    objectSamplePrefix: typeof objectText === "string" ? objectText.trim().slice(0, 12) : null,
    dateType: typeof first.date,
    secondsReadType: typeof first.seconds_read,
    skipReason: skipReason ?? classifySessionSkipReason(skipTarget),
  };
}

async function importLinkedMatterItems(
  itemIds: string[],
  embeddedItems: Array<NonNullable<ReturnType<typeof extractEmbeddedMatterItem>>>,
  affectedDates: Set<string>,
  checkpoint: SyncCheckpoint,
  diagnostics: MatterSyncDiagnostics
): Promise<{ itemCount: number; tagCount: number; annotationCount: number }> {
  if (itemIds.length === 0) {
    return { itemCount: 0, tagCount: 0, annotationCount: 0 };
  }

  const syncedAt = new Date().toISOString();
  const placeholderRows = itemIds.map((itemId) => normalizeMatterItem(createPlaceholderMatterItem(itemId), syncedAt));
  await upsertInBatches(placeholderRows, upsertMatterItems);

  const embeddedItemsById = new Map(embeddedItems.map((item) => [item.id, item]));
  const results = [];
  let returnedItemObjects = 0;

  for (const itemId of itemIds) {
    const embeddedItem = embeddedItemsById.get(itemId);
    if (embeddedItem) {
      results.push(embeddedItem);
      returnedItemObjects += 1;
      continue;
    }

    diagnostics.requestCount += 1;
    const fetchedItem = await getOptionalMatterItem(itemId);
    if (fetchedItem) {
      results.push(fetchedItem);
      returnedItemObjects += 1;
    }
  }
  diagnostics.itemsReturned += returnedItemObjects;

  const enrichedCounts = await importMatterItemPage(
    {
      object: "list",
      results,
      has_more: false,
      next_cursor: null,
    },
    affectedDates,
    checkpoint
  );

  return {
    itemCount: itemIds.length,
    tagCount: enrichedCounts.tagCount,
    annotationCount: enrichedCounts.annotationCount,
  };
}

async function getOptionalMatterItem(itemId: string): Promise<Awaited<ReturnType<typeof getMatterItem>> | null> {
  try {
    return await getMatterItem(itemId);
  } catch (error) {
    if (isOptionalMatterEndpointError(error) || error instanceof MatterRateLimitError) {
      logMatterApiError(error, `get optional Matter item ${itemId}`);
      return null;
    }
    throw error;
  }
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
    dates.add(timestampToCalendarDate(date, getAppTimezone()));
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

function isRecentActivityMode(mode: MatterSyncMode): boolean {
  return mode === "recent_activity" || mode === "recent_activity_manual" || mode === "recent_activity_scheduled";
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
