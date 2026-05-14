import "server-only";

import { getMatterAccount, iterateMatterAnnotations, iterateMatterItems, iterateMatterReadingSessions, iterateMatterTags, MatterApiError } from "@/lib/matter-api";
import {
  createSyncRun,
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

export async function syncMatterData(): Promise<MatterSyncResult> {
  let syncRunId: string | null = null;

  try {
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
    let checkpointTimestamp: string | null = null;

    for await (const item of iterateMatterItems({ status: "all" })) {
      const itemRow = normalizeMatterItem(item, syncedAt);
      itemRows.push(itemRow);
      itemRowsById.set(itemRow.id, itemRow);
      itemIds.add(itemRow.id);
      checkpointTimestamp = maxIsoTimestamp(checkpointTimestamp, itemRow.updated_at_matter);

      const normalizedTags = normalizeMatterItemTags(item);
      for (const tagRow of normalizedTags.matterTags) {
        tagRowsById.set(tagRow.id, tagRow);
      }
      for (const itemTagRow of normalizedTags.itemTags) {
        itemTagRowsByKey.set(`${itemTagRow.item_id}:${itemTagRow.tag_id}`, itemTagRow);
      }
    }

    for await (const tag of iterateOptionalMatterTags()) {
      const tagRow = normalizeMatterTag(tag);
      tagRowsById.set(tagRow.id, tagRow);
      checkpointTimestamp = maxIsoTimestamp(checkpointTimestamp, tagRow.updated_at_matter);
    }

    await upsertInBatches([...tagRowsById.values()], upsertMatterTags);
    await upsertInBatches(itemRows, upsertMatterItems);
    await replaceItemTags([...itemIds], [...itemTagRowsByKey.values()]);

    const sessionRows: TablesInsert<"reading_sessions">[] = [];
    const affectedDates = new Set<string>();

    for await (const session of iterateMatterReadingSessions()) {
      const sessionRow = normalizeReadingSession(session, { item: session.item_id ? itemRowsById.get(session.item_id) : null });
      if (!sessionRow) {
        continue;
      }

      sessionRows.push(sessionRow);
      addDateFromTimestamp(affectedDates, sessionRow.started_at);
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
        checkpointTimestamp = maxIsoTimestamp(checkpointTimestamp, annotationRow.updated_at_matter);
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
      checkpoint_timestamp: checkpointTimestamp,
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

async function* iterateOptionalMatterTags() {
  try {
    yield* iterateMatterTags();
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
