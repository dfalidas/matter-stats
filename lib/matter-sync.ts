import "server-only";
import { randomUUID } from "node:crypto";
import { emptyMatterPagePlan, validateMatterPage, validateMatterPagePlan, MatterPageValidationError, MATTER_ENRICHMENT_MAX_ROWS, type MatterPagePlan } from "./matter-page-plan";

import {
  getMatterAccount,
  getMatterItem,
  listMatterAnnotations,
  listMatterItems,
  listMatterReadingSessions,
  MatterApiError,
  MatterRateLimitError,
  type MatterListResponse,
} from "@/lib/matter-api";
import {
  commitMatterPage,
  createSyncRun,
  getMatterSyncStream,
  getMatterSyncStreams,
  getMatterSyncState,
  updateSyncRun,
  upsertMatterSyncStream,
} from "@/lib/supabase-admin";
import { acquireMatterSyncLease, renewMatterSyncLease, releaseMatterSyncLease } from "@/lib/matter-sync-lease";
import { leaseRpcArgs, MatterSyncLeaseLostError, type MatterSyncLease } from "@/lib/matter-sync-lease-context";
import { processPendingDailyStats } from "@/lib/daily-stats";
import { getAppTimezone } from "@/lib/calendar";
import type { Json, MatterSyncStream, TablesInsert } from "@/lib/supabase-types";
import {
  createPlaceholderMatterItem,
  extractEmbeddedMatterItem,
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
  createEmptyMatterBatchCounts,
  buildMatterRateLimitMessage,
  getMatterSyncItemsLimit,
  getMatterSyncSessionsLimit,
  getRecentActivityWindowStart,
  isMatterRateLimitActive,
  type MatterBatchCounts,
  type MatterRecentActivityWindow,
  type MatterSyncMode,
} from "@/lib/matter-sync-progress";

import {
  persistActiveMatterCycle,
  startOrResumeMatterCycle,
  type ActiveMatterCycle,
} from "@/lib/matter-sync-cycle";

const OPTIONAL_MATTER_STATUSES = new Set([403, 404]);

export type MatterSyncResult = {
  ok: boolean;
  skippedReason?: "busy" | "rate_limited";
  message: string;
  syncRunId?: string;
  itemsSynced?: number;
  sessionsSynced?: number;
  annotationsSynced?: number;
  tagsSynced?: number;
  hasMore?: boolean;
  rateLimitedUntil?: string | null;
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
  acquireLease: typeof acquireMatterSyncLease;
  renewLease: typeof renewMatterSyncLease;
  releaseLease: typeof releaseMatterSyncLease;
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
  recoverRollups: typeof processPendingDailyStats;
  commitPage: typeof commitMatterPage;
  importSessions: typeof importMatterSessionPage;
  importItems: typeof importMatterItemPage;
};

export const productionSyncDeps: MatterSyncRuntimeDeps = {
  acquireLease: acquireMatterSyncLease,
  renewLease: renewMatterSyncLease,
  releaseLease: releaseMatterSyncLease,
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
  recoverRollups: processPendingDailyStats,
  commitPage: commitMatterPage,
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
  let lease: MatterSyncLease | null = null;
  let syncRunId: string | null = null;
  let storedState: MatterSyncStream | null = null;
  let activeCycle: ActiveMatterCycle | null = null;
  // Trigger identities share the existing recent_activity database run label.
  const runMode = isRecentActivityMode(mode) ? "recent_activity" : mode;

  try {
    lease = await deps.acquireLease();
    if (!lease) return { ok: false, skippedReason: "busy", message: "Matter sync is already running for this account. Try again shortly." };
    leaseRpcArgs(lease);
    // Recovery is independent of upstream availability, cooldowns and empty pages.
    await deps.recoverRollups(lease);
    const invocationNow = deps.now();
    const stream = mode === "backfill_library" ? "library_items" : "recent_sessions";
    const rateLimitedUntil = await loadActiveMatterCooldown(deps, invocationNow);
    if (rateLimitedUntil) {
      return {
        ok: false,
        message: buildMatterRateLimitMessage(rateLimitedUntil),
        skippedReason: "rate_limited",
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
    const syncRun = await deps.createRun({ status: "running", started_at: startedAt, sync_mode: runMode }, lease);
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
    await deps.upsertStream(persistActiveMatterCycle(activeCycle, activeCycle.cursor), lease);
    await deps.renewLease(lease);
    await deps.getAccount(() => deps.renewLease(lease!));
    await deps.renewLease(lease);
    const counts = createEmptyMatterBatchCounts();
    const diagnostics = createEmptyMatterSyncDiagnostics();
    const { plan, hasMore, nextCursor } = await prepareNextMatterBatch({ cycle: activeCycle, counts, diagnostics, deps, lease });
    validateMatterPagePlan(plan);
    await deps.renewLease(lease);
    const persistedState = await deps.commitPage({
      receiptId: randomUUID(), expected: persistActiveMatterCycle(activeCycle, activeCycle.cursor),
      plan, hasMore, nextCursor, timezone: getAppTimezone(),
    }, lease);
    // Checkpoint durability never depends on this calculation succeeding.
    await deps.recoverRollups(lease);
    const finishedRun = await deps.updateRun(syncRunId, {
      status: "success",
      finished_at: new Date().toISOString(),
      items_synced: counts.items,
      sessions_synced: counts.sessions,
      annotations_synced: counts.annotations,
      tags_synced: counts.tags,
      sync_mode: runMode,
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
    }, lease);

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

    if (rateLimitedUntil && lease) {
      try {
        if (activeCycle) {
          await deps.upsertStream(persistActiveMatterCycle(activeCycle, activeCycle.cursor, rateLimitedUntil), lease);
        }
      } catch (stateError) {
        console.error("Matter sync rate-limit state update failed", { error: sanitizeLogError(stateError) });
      }
    }

    if (syncRunId && lease) {
      try {
        await deps.updateRun(syncRunId, {
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: sanitizedError,
          sync_mode: runMode,
          checkpoint_timestamp: null,
        }, lease);
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
      message: `Matter sync failed safely. ${sanitizedError} Earlier committed work remains; retry resumes or replays the stored cycle.`,
      syncRunId: syncRunId ?? undefined,
    };
  } finally {
    if (lease) {
      try { await deps.releaseLease(lease); }
      catch (error) { console.error("Matter sync lease release failed", { error: sanitizeLogError(error) }); }
    }
  }
}

async function prepareNextMatterBatch({ cycle, counts, diagnostics, deps, lease }: {
  cycle: ActiveMatterCycle; counts: MatterBatchCounts; diagnostics: MatterSyncDiagnostics;
  deps: MatterSyncRuntimeDeps; lease: MatterSyncLease;
}): Promise<{ plan: MatterPagePlan; hasMore: boolean; nextCursor: string | null }> {
  await deps.renewLease(lease);
  diagnostics.requestCount += 1;
  if (cycle.stream === "library_items") {
    const page = await deps.listItems({ status: "all", order: "updated", updatedSince: cycle.filters.updated_since,
      cursor: cycle.cursor ?? undefined, limit: cycle.pageLimit }, () => deps.renewLease(lease));
    await deps.renewLease(lease);
    validateMatterPage(page, cycle.pageLimit, cycle.cursor);
    diagnostics.itemsReturned += page.results.length;
    recordMatterPageDiagnostics(diagnostics, page);
    const prepared = await deps.importItems(page, lease);
    counts.items += prepared.itemCount;
    counts.tags += prepared.tagCount;
    counts.annotations += prepared.annotationCount;
    return { plan: prepared.plan, hasMore: page.has_more, nextCursor: page.next_cursor };
  }
  const page = await deps.listSessions({ since: cycle.filters.since, cursor: cycle.cursor ?? undefined,
    limit: cycle.pageLimit }, () => deps.renewLease(lease));
  await deps.renewLease(lease);
  validateMatterPage(page, cycle.pageLimit, cycle.cursor);
  diagnostics.sessionsReturned += page.results.length;
  recordMatterPageDiagnostics(diagnostics, page);
  const prepared = await deps.importSessions(page, diagnostics, lease);
  counts.sessions += prepared.sessions;
  counts.items += prepared.items;
  counts.tags += prepared.tags;
  counts.annotations += prepared.annotations;
  return { plan: prepared.plan, hasMore: page.has_more, nextCursor: page.next_cursor };
}

// Preparation performs upstream reads and normalization only. Old-row effects
// and all database writes belong to commit_matter_page's transaction.
async function importMatterItemPage(page: MatterListResponse<NormalizableMatterItem>, lease: MatterSyncLease) {
  const plan = emptyMatterPagePlan();
  const items = new Map<string, MatterItemRow>();
  const tags = new Map<string, TablesInsert<"matter_tags">>();
  const links = new Map<string, TablesInsert<"item_tags">>();
  for (const item of page.results) {
    if (!item || typeof item.id !== "string" || !item.id.trim()) throw new MatterPageValidationError("invalid_item_id");
    items.set(item.id, normalizeMatterItem(item, new Date().toISOString()));
    if (item.tags !== undefined && !Array.isArray(item.tags)) throw new MatterPageValidationError("invalid_tags");
    for (const tag of item.tags ?? []) {
      if (!tag || typeof tag.id !== "string" || !tag.id.trim()) throw new MatterPageValidationError("invalid_tag_id");
    }
    const normalized = normalizeMatterItemTags(item);
    for (const tag of normalized.matterTags) tags.set(tag.id, tag);
    for (const link of normalized.itemTags) links.set(JSON.stringify([link.item_id, link.tag_id]), link);
    if (tags.size > MATTER_ENRICHMENT_MAX_ROWS || links.size > MATTER_ENRICHMENT_MAX_ROWS) throw new MatterPageValidationError("enrichment_bound_exceeded");
  }
  plan.items = [...items.values()]; plan.tags = [...tags.values()];
  plan.itemTagIds = [...items.keys()]; plan.itemTags = [...links.values()];
  const annotations = new Map<string, TablesInsert<"annotations">>();
  const enrichmentBudget = { rows: 0, pages: 0 };
  for (const id of items.keys()) {
    for await (const annotation of iterateOptionalMatterAnnotations(id, lease, enrichmentBudget)) {
      if (!annotation || typeof annotation.id !== "string" || !annotation.id.trim() || !annotation.item_id) {
        console.info("Matter sync row skipped", { operation: "annotation", reason: "missing_identity" });
        continue;
      }
      const row = normalizeAnnotation(annotation);
      if (!row) { console.info("Matter sync row skipped", { operation: "annotation", reason: "missing_item_id" }); continue; }
      annotations.set(row.id!, row);
      if (annotations.size > MATTER_ENRICHMENT_MAX_ROWS) throw new MatterPageValidationError("enrichment_bound_exceeded");
      // Accepted annotation links can differ from the parent endpoint item.
      if (!items.has(row.item_id)) {
        if (!plan.placeholders.some((r) => r.id === row.item_id)) plan.placeholders.push(normalizeMatterItem(createPlaceholderMatterItem(row.item_id)));
      }
    }
  }
  plan.annotations = [...annotations.values()];
  validateMatterPagePlan(plan);
  return { plan, itemCount: items.size, tagCount: tags.size, annotationCount: annotations.size };
}

async function importMatterSessionPage(page: Awaited<ReturnType<typeof listMatterReadingSessions>>, diagnostics: MatterSyncDiagnostics, lease: MatterSyncLease) {
  const sessionRows = new Map<string, TablesInsert<"reading_sessions">>();
  let firstSkippedSession: unknown = null;
  for (const session of page.results) {
    const skipReason = classifySessionSkipReason(session);
    if (skipReason) {
      diagnostics.sessionsSkipped += 1;
      console.info("Matter sync row skipped", { operation: "session", reason: skipReason });
      if (diagnostics.firstSkipReason === null) { diagnostics.firstSkipReason = skipReason; firstSkippedSession = session; }
      continue;
    }
    const row = normalizeReadingSession(session)!;
    if (!row.item_id) diagnostics.sessionsWithoutLinkedItem += 1;
    sessionRows.set(row.id!, row);
  }
  if (page.results.length > 0) diagnostics.firstSessionShape = summarizeReadingSessionShapeWithSkip(page.results[0], diagnostics.firstSkipReason, firstSkippedSession) as Json;
  const linkedIds = [...new Set([...sessionRows.values()].flatMap((r) => r.item_id ? [r.item_id] : []))];
  const embedded = new Map(page.results.map(extractEmbeddedMatterItem).filter((i): i is NonNullable<typeof i> => i !== null).map((i) => [i.id, i]));
  const results: NormalizableMatterItem[] = [];
  for (const id of linkedIds) {
    const item = embedded.get(id) ?? await getOptionalMatterItem(id, lease);
    if (!embedded.has(id)) diagnostics.requestCount += 1;
    if (item) {
      if (item.id !== id) throw new MatterPageValidationError("divergent_linked_item");
      results.push(item);
    }
  }
  diagnostics.itemsReturned += results.length;
  const prepared = await importMatterItemPage({ object: "list", results, has_more: false, next_cursor: null }, lease);
  const plan = prepared.plan;
  const known = new Set([...plan.items, ...plan.placeholders].map((r) => r.id));
  for (const id of linkedIds) if (!known.has(id)) plan.placeholders.push(normalizeMatterItem(createPlaceholderMatterItem(id)));
  plan.sessions = [...sessionRows.values()];
  validateMatterPagePlan(plan);
  return { plan, sessions: sessionRows.size, items: linkedIds.length, tags: prepared.tagCount, annotations: prepared.annotationCount };
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
    dateType: typeof first.date,
    secondsReadType: typeof first.seconds_read,
    skipReason: skipReason ?? classifySessionSkipReason(skipTarget),
  };
}

async function getOptionalMatterItem(itemId: string, lease: MatterSyncLease): Promise<Awaited<ReturnType<typeof getMatterItem>> | null> {
  await renewMatterSyncLease(lease);
  try {
    const item = await getMatterItem(itemId, () => renewMatterSyncLease(lease));
    await renewMatterSyncLease(lease);
    return item;
  } catch (error) {
    if (isOptionalMatterEndpointError(error) || error instanceof MatterRateLimitError) {
      console.info("Matter optional endpoint unavailable", { operation: "item", status: (error as MatterApiError).status });
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

async function* iterateOptionalMatterAnnotations(itemId: string, lease: MatterSyncLease, budget: { rows: number; pages: number }) {
  let cursor: string | null = null;
  const cursors = new Set<string>();
  try {
    do {
      if (++budget.pages > 100) throw new MatterPageValidationError("annotation_page_bound_exceeded");
      await renewMatterSyncLease(lease);
      const page = await listMatterAnnotations(itemId, { limit: 100, cursor: cursor ?? undefined }, () => renewMatterSyncLease(lease));
      await renewMatterSyncLease(lease);
      validateMatterPage(page, 100, cursor);
      budget.rows += page.results.length;
      if (budget.rows > MATTER_ENRICHMENT_MAX_ROWS) throw new MatterPageValidationError("enrichment_bound_exceeded");
      if (page.next_cursor && cursors.has(page.next_cursor)) throw new MatterPageValidationError("annotation_cursor_loop");
      if (page.next_cursor) cursors.add(page.next_cursor);
      yield* page.results;
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
  } catch (error) {
    if (isOptionalMatterEndpointError(error)) {
      console.info("Matter optional endpoint unavailable", { operation: "annotations", status: (error as MatterApiError).status });
      return;
    }
    throw error;
  }
}

function isOptionalMatterEndpointError(error: unknown): boolean {
  return error instanceof MatterApiError && OPTIONAL_MATTER_STATUSES.has(error.status);
}

function sanitizeSyncError(error: unknown): string {
  if (error instanceof MatterSyncLeaseLostError) return error.message;
  if (error instanceof MatterPageValidationError) return `Matter page rejected (${error.reason}); no page writes were applied.`;
  if (error instanceof MatterApiError) {
    return `Matter API request failed during sync (status ${error.status}${error.code ? `, code ${error.code}` : ""}).`;
  }

  return "Matter sync failed because the local database update could not be completed.";
}

function sanitizeLogError(error: unknown): { name: string; message: string; status?: number; code?: string | null } {
  if (error instanceof MatterPageValidationError) return { name: error.name, message: error.reason };
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

function isRecentActivityMode(mode: MatterSyncMode): boolean {
  return mode === "recent_activity" || mode === "recent_activity_manual" || mode === "recent_activity_scheduled";
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
