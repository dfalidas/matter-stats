import "server-only";
import { randomUUID } from "node:crypto";
import { emptyMatterPagePlan, validateMatterItem, validateMatterPage, validateMatterPagePlan, MatterPageValidationError, MATTER_ENRICHMENT_MAX_ROWS, type MatterPagePlan } from "./matter-page-plan";

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
  getMatterContinuation, requestMatterHistory, beginMatterHistory, turnMatterContinuation, cooldownMatterAccount,
  commitMatterPage,
  getMatterPageReceipt,
  getSupabaseAdminClient,
  createSyncRun,
  getMatterSyncStream,
  getMatterSyncStreams,
  getMatterSyncState,
  updateSyncRun,
  upsertMatterSyncStream,
} from "@/lib/supabase-admin";
import { acquireMatterSyncLease, renewMatterSyncLease, releaseMatterSyncLease } from "@/lib/matter-sync-lease";
import { leaseRpcArgs, MatterSyncLeaseLostError, type MatterSyncLease } from "@/lib/matter-sync-lease-context";
import { MatterInvocationBudget, MatterBudgetStop, withMatterInvocationBudget, type MatterInvocationLimits } from "./matter-invocation-budget";
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
  DEFAULT_RECENT_ACTIVITY_WINDOW,
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

import { prepareMatterRequestWork, withMatterRequestContext } from "./matter-request-coordinator";
import { MatterRequestDeferred, matterCooldownDeadline } from "./matter-request-policy";

const OPTIONAL_MATTER_STATUSES = new Set([403, 404]);

export type MatterSyncResult = {
  ok: boolean;
  status?: "complete" | "partial";
  pagesCommitted?: number;
  requestsAttempted?: number;
  historyStatus?: string;
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
  recordInvocation?: (id: string, trigger: string, outcome: string) => Promise<void>;
  prepareRequestWork?: typeof prepareMatterRequestWork;
  cooldownAccount: typeof cooldownMatterAccount;
  getContinuation: typeof getMatterContinuation;
  requestHistory: typeof requestMatterHistory;
  beginHistory: typeof beginMatterHistory;
  turnContinuation: typeof turnMatterContinuation;
  budgetClock?: () => number;
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
  getPageReceipt: typeof getMatterPageReceipt;
  importSessions: typeof importMatterSessionPage;
  importItems: typeof importMatterItemPage;
};

export const productionSyncDeps: MatterSyncRuntimeDeps = {
  recordInvocation: async (id, trigger, outcome) => {
    const { error } = await getSupabaseAdminClient().rpc("record_matter_invocation", { p_id: id, p_trigger: trigger, p_outcome: outcome });
    if (error) throw new Error("Invocation evidence unavailable");
  },
  prepareRequestWork: prepareMatterRequestWork,
  cooldownAccount: cooldownMatterAccount,
  getContinuation: getMatterContinuation, requestHistory: requestMatterHistory,
  beginHistory: beginMatterHistory, turnContinuation: turnMatterContinuation,
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
  getPageReceipt: getMatterPageReceipt,
  importSessions: importMatterSessionPage,
  importItems: importMatterItemPage,
};

function createEmptyMatterSyncDiagnostics(): MatterSyncDiagnostics {
  return {
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
): Promise<{ rateLimitedUntil: string | null; message: string | null; historyStatus?: string }> {
  const rateLimitedUntil = await loadActiveMatterCooldown(deps);

  if (!rateLimitedUntil) {
    const intent = await deps.getContinuation();
    return { rateLimitedUntil: null, message: null, historyStatus: intent.history_status };
  }

  return {
    rateLimitedUntil,
    message: buildMatterRateLimitMessage(rateLimitedUntil, getAppTimezone()),
  };
}

export async function syncMatterData(
  mode: MatterSyncMode = "recent_activity_manual",
  options: { recentActivityWindow?: MatterRecentActivityWindow; budget?: MatterInvocationLimits } = {},
  deps: MatterSyncRuntimeDeps = productionSyncDeps
): Promise<MatterSyncResult> {
  const budget = new MatterInvocationBudget(options.budget, deps.budgetClock);
  const id = randomUUID();
  const trigger = mode === "recent_activity_scheduled" ? "scheduled" : mode === "recent_activity" ? "unknown" : "manual";
  const record = async (outcome: string) => {
    try { await deps.recordInvocation?.(id, trigger, outcome); }
    catch { console.error("Matter invocation evidence unavailable"); }
  };
  await record("attempted");
  const result = await withMatterInvocationBudget(budget, () => runMatterInvocation(mode, options, deps, budget));
  await record(result.skippedReason === "busy" ? "skipped_locked" : result.skippedReason === "rate_limited" ? "skipped_rate_limited"
    : result.status === "partial" ? "partial" : result.ok ? "complete" : "error");
  return result;
}

async function runMatterInvocation(mode: MatterSyncMode, options: { recentActivityWindow?: MatterRecentActivityWindow },
  deps: MatterSyncRuntimeDeps, budget: MatterInvocationBudget): Promise<MatterSyncResult> {
  let lease: MatterSyncLease | null = null;
  let syncRunId: string | null = null;
  let activeCycle: ActiveMatterCycle | null = null;
  const counts = createEmptyMatterBatchCounts();
  const diagnostics = createEmptyMatterSyncDiagnostics();
  // Retain existing DB run labels; history is a recent_activity invocation.
  const runMode = mode === "backfill_library" ? mode : "recent_activity";
  const explicitHistory = mode === "backfill_sessions"
    || ((mode === "recent_activity_manual" || mode === "recent_activity") && options.recentActivityWindow === "all");
  let stop: MatterBudgetStop | null = null;
  try {
    lease = await deps.acquireLease();
    if (!lease) return { ok: false, skippedReason: "busy", message: "Matter sync is already running for this account. Try again shortly." };
    leaseRpcArgs(lease);
    let intent = explicitHistory ? await deps.requestHistory(lease) : await deps.getContinuation();
    // Recovery runs during cooldown as well, bounded to two 32-marker snapshots.
    await deps.recoverRollups(lease, budget.canRecover);
    const invocationNow = deps.now();
    const rateLimitedUntil = await loadActiveMatterCooldown(deps, invocationNow);
    if (rateLimitedUntil) return { ok: false, skippedReason: "rate_limited", message: buildMatterRateLimitMessage(rateLimitedUntil, getAppTimezone()), rateLimitedUntil, historyStatus: intent.history_status };
    if (explicitHistory && intent.history_status === "complete") return {
      ok: true, status: "complete", historyStatus: "complete", pagesCommitted: 0, requestsAttempted: 0,
      message: "The requested enumeration of all sessions available from Matter is complete. This does not establish retention or universal historical completeness.",
    };
    const states = new Map((await deps.getStreams()).map((state) => [state.stream, state]));
    const requestedWindow = isRecentActivityMode(mode) && mode !== "recent_activity_scheduled" && !explicitHistory
      ? options.recentActivityWindow : undefined;
    const initialSession = states.get("recent_sessions");
    if (requestedWindow && initialSession?.cycle_active && initialSession.coverage_window
        && requestedWindow !== initialSession.coverage_window && intent.history_status !== "running") {
      return { ok: false, message: "The requested window conflicts with the active session contract. Resume its pinned coverage or wait for it to finish." };
    }
    const eligible = new Set<"recent_sessions" | "library_items">();
    if (initialSession?.cycle_active || intent.history_status === "pending" || intent.history_status === "running"
        || isRecentActivityMode(mode)) eligible.add("recent_sessions");
    if (states.get("library_items")?.cycle_active || mode === "backfill_library") eligible.add("library_items");
    const startedAt = invocationNow.toISOString();
    const run = await deps.createRun({ status: "running", started_at: startedAt, sync_mode: runMode }, lease);
    syncRunId = run.id;
    await deps.renewLease(lease);
    await withMatterRequestContext({ slot: "bootstrap", lease, recover: mode !== "recent_activity_scheduled" },
      () => deps.getAccount(() => deps.renewLease(lease!)));
    await deps.renewLease(lease);
    let checkpoint: string | null = null;
    const cursors = new Map<string, Set<string>>();
    while (eligible.size) {
      const stream = eligible.has(intent.next_stream) ? intent.next_stream : [...eligible][0];
      let stored = states.get(stream) ?? null;
      if (stream === "recent_sessions" && intent.history_status === "pending" && !stored?.cycle_active) {
        stored = await deps.beginHistory(getMatterSyncSessionsLimit(), startedAt, lease);
        intent = await deps.getContinuation();
        states.set(stream, stored);
      }
      activeCycle = startOrResumeMatterCycle({ stream, stored, now: invocationNow,
        configuredLimit: stream === "recent_sessions" ? getMatterSyncSessionsLimit() : getMatterSyncItemsLimit(),
        initialSince: stream === "recent_sessions" ? getRecentActivityWindowStart(invocationNow, requestedWindow) : null,
        requestedWindow: stream === "recent_sessions" ? requestedWindow ?? DEFAULT_RECENT_ACTIVITY_WINDOW : null });
      try { budget.admitPage(activeCycle.pageLimit); }
      catch (error) { if (error instanceof MatterBudgetStop && error.reason !== "timeout") { stop = error; break; } throw error; }
      if (!stored?.cycle_active) await deps.upsertStream(persistActiveMatterCycle(activeCycle, activeCycle.cursor), lease);
      // Persist the next turn before reads: an expensive/failed page cannot starve
      // its sibling after process death or repeated small/time-limited invocations.
      await deps.turnContinuation(stream, lease);
      intent = { ...intent, next_stream: stream === "recent_sessions" ? "library_items" : "recent_sessions" };
      const previousReceiptId = await deps.getPageReceipt(stream);
      const pageCounts = createEmptyMatterBatchCounts();
      let prepared: Awaited<ReturnType<typeof prepareNextMatterBatch>>;
      try {
        await deps.prepareRequestWork?.(persistActiveMatterCycle(activeCycle, activeCycle.cursor), lease);
        prepared = await withMatterRequestContext({ slot: stream, lease, recover: mode !== "recent_activity_scheduled" },
          () => prepareNextMatterBatch({ cycle: activeCycle!, counts: pageCounts, diagnostics, deps, lease: lease! }));
        budget.check();
      }
      catch (error) { if (error instanceof MatterBudgetStop && error.reason !== "timeout") { stop = error; break; } throw error; }
      validateMatterPagePlan(prepared.plan);
      const seen = cursors.get(stream) ?? new Set<string>(activeCycle.cursor ? [activeCycle.cursor] : []);
      if (prepared.nextCursor && seen.has(prepared.nextCursor)) throw new MatterPageValidationError("stream_cursor_loop");
      if (prepared.nextCursor) seen.add(prepared.nextCursor);
      cursors.set(stream, seen);
      await deps.renewLease(lease);
      const persisted = await deps.commitPage({ receiptId: randomUUID(), previousReceiptId,
        expected: persistActiveMatterCycle(activeCycle, activeCycle.cursor), ...prepared, timezone: getAppTimezone() }, lease);
      budget.pages++;
      for (const key of ["items", "sessions", "annotations", "tags"] as const) counts[key] += pageCounts[key];
      states.set(stream, persisted);
      checkpoint = persisted.completed_watermark;
      // Always derive the next expected contract from the returned durable state.
      activeCycle = persisted.cycle_active ? startOrResumeMatterCycle({ stream, stored: persisted, now: invocationNow, configuredLimit: persisted.page_limit }) : null;
      if (!persisted.cycle_active) {
        intent = await deps.getContinuation();
        if (!(stream === "recent_sessions" && intent.history_status === "pending")) eligible.delete(stream);
      }
    }
    await deps.recoverRollups(lease, budget.canRecover);
    intent = await deps.getContinuation();
    const hasMore = eligible.size > 0 || intent.history_status === "pending" || intent.history_status === "running";
    await deps.updateRun(syncRunId, {
      status: "success", finished_at: deps.now().toISOString(), sync_mode: runMode,
      items_synced: counts.items, sessions_synced: counts.sessions, annotations_synced: counts.annotations, tags_synced: counts.tags,
      matter_requests_count: budget.requests, matter_sessions_returned: diagnostics.sessionsReturned,
      matter_items_returned: diagnostics.itemsReturned, matter_sessions_skipped: diagnostics.sessionsSkipped,
      matter_sessions_without_linked_item: diagnostics.sessionsWithoutLinkedItem,
      matter_first_session_shape: diagnostics.firstSessionShape, matter_has_more: hasMore,
      matter_next_cursor_present: diagnostics.lastNextCursorPresent, error_message: null,
      checkpoint_timestamp: hasMore ? null : checkpoint,
    }, lease);
    return { ok: true, status: hasMore ? "partial" : "complete", hasMore, syncRunId,
      pagesCommitted: budget.pages, requestsAttempted: budget.requests, historyStatus: intent.history_status,
      itemsSynced: counts.items, sessionsSynced: counts.sessions, annotationsSynced: counts.annotations, tagsSynced: counts.tags,
      message: buildMatterSyncMessage(counts, hasMore, explicitHistory ? "backfill_sessions" : mode, {
        sessionsReturned: diagnostics.sessionsReturned, sessionsSkipped: diagnostics.sessionsSkipped,
        sessionsWithoutLinkedItem: diagnostics.sessionsWithoutLinkedItem,
      }) + (stop ? ` Invocation ${stop.reason} budget reached; the last committed checkpoint is retained.` : ""),
    };
  } catch (error) {
    const rateLimitedUntil = error instanceof MatterRequestDeferred && error.reason === "quota" ? error.nextAt : getRateLimitedUntil(error, deps.now());
    const sanitizedError = sanitizeSyncError(error);
    const budgetPartial = error instanceof MatterBudgetStop && error.reason !== "timeout";
    if (rateLimitedUntil && lease) {
      try { await deps.cooldownAccount(rateLimitedUntil, lease); }
      catch (stateError) { console.error("Matter cooldown persistence failed", { error: sanitizeLogError(stateError) }); }
    }
    if (syncRunId && lease) {
      try { await deps.updateRun(syncRunId, { status: budgetPartial ? "success" : "error", finished_at: deps.now().toISOString(), error_message: budgetPartial ? null : sanitizedError,
        sync_mode: runMode, matter_requests_count: budget.requests, checkpoint_timestamp: null, matter_has_more: true,
        items_synced: counts.items, sessions_synced: counts.sessions, annotations_synced: counts.annotations, tags_synced: counts.tags }, lease); }
      catch (updateError) { console.error("Matter run update failed", { error: sanitizeLogError(updateError) }); }
    }
    console.error("Matter sync failed", { syncRunId, error: sanitizeLogError(error) });
    return { ok: budgetPartial, status: budgetPartial ? "partial" : undefined, hasMore: true, pagesCommitted: budget.pages, requestsAttempted: budget.requests,
      itemsSynced: counts.items, sessionsSynced: counts.sessions, annotationsSynced: counts.annotations, tagsSynced: counts.tags,
      syncRunId: syncRunId ?? undefined, rateLimitedUntil,
      message: rateLimitedUntil ? buildMatterRateLimitMessage(rateLimitedUntil, getAppTimezone())
        : `Matter sync stopped safely. ${sanitizedError} Earlier committed work remains; continuation uses the stored contract.`,
    };
  } finally {
    if (lease) {
      try { await deps.releaseLease(lease); }
      catch (error) { console.error("Matter lease release failed", { error: sanitizeLogError(error) }); }
    }
  }
}

async function prepareNextMatterBatch({ cycle, counts, diagnostics, deps, lease }: {
  cycle: ActiveMatterCycle; counts: MatterBatchCounts; diagnostics: MatterSyncDiagnostics;
  deps: MatterSyncRuntimeDeps; lease: MatterSyncLease;
}): Promise<{ plan: MatterPagePlan; hasMore: boolean; nextCursor: string | null }> {
  await deps.renewLease(lease);

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
    validateMatterItem(item);
    items.set(item.id, normalizeMatterItem(item, new Date().toISOString()));
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
    if (isOptionalMatterEndpointError(error)) {
      console.info("Matter optional endpoint unavailable", { operation: "item", status: (error as MatterApiError).status });
      return null;
    }
    throw error;
  }
}



function getRateLimitedUntil(error: unknown, now: Date): string | null {
  if (!(error instanceof MatterRateLimitError)) {
    return null;
  }

  return new Date(matterCooldownDeadline(error.rateLimit.retryAfterSeconds, error.rateLimit.reset, now.getTime())).toISOString();
}

async function* iterateOptionalMatterAnnotations(itemId: string, lease: MatterSyncLease, budget: { rows: number; pages: number }) {
  let cursor: string | null = null;
  const cursors = new Set<string>();
  let acceptedPages = 0;
  try {
    do {
      if (++budget.pages > 100) throw new MatterPageValidationError("annotation_page_bound_exceeded");
      await renewMatterSyncLease(lease);
      const page = await listMatterAnnotations(itemId, { limit: 100, cursor: cursor ?? undefined }, () => renewMatterSyncLease(lease));
      await renewMatterSyncLease(lease);
      validateMatterPage(page, 100, cursor);
      acceptedPages++;
      budget.rows += page.results.length;
      if (budget.rows > MATTER_ENRICHMENT_MAX_ROWS) throw new MatterPageValidationError("enrichment_bound_exceeded");
      if (page.next_cursor && cursors.has(page.next_cursor)) throw new MatterPageValidationError("annotation_cursor_loop");
      if (page.next_cursor) cursors.add(page.next_cursor);
      yield* page.results;
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
  } catch (error) {
    if (isOptionalMatterEndpointError(error) && acceptedPages === 0) {
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
  if (error instanceof MatterRequestDeferred) return error.message;
  if (error instanceof MatterBudgetStop) return error.message;
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
