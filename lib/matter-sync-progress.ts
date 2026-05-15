export const MATTER_SYNC_BATCH_LIMIT = 100;

export type MatterSyncPhase = "items" | "tags" | "sessions" | "complete";

export type MatterBatchCounts = {
  items: number;
  sessions: number;
  annotations: number;
  tags: number;
};

export function createEmptyMatterBatchCounts(): MatterBatchCounts {
  return {
    items: 0,
    sessions: 0,
    annotations: 0,
    tags: 0,
  };
}

export function addMatterBatchCounts(current: MatterBatchCounts, next: MatterBatchCounts): MatterBatchCounts {
  return {
    items: current.items + next.items,
    sessions: current.sessions + next.sessions,
    annotations: current.annotations + next.annotations,
    tags: current.tags + next.tags,
  };
}

export function buildMatterSyncMessage(counts: MatterBatchCounts, hasMore: boolean): string {
  const imported = `Imported ${counts.items} items and ${counts.sessions} sessions`;
  const details = `(${counts.annotations} annotations and ${counts.tags} tags).`;

  if (hasMore) {
    return `Sync started. ${imported} ${details} More data remains — click Sync again.`;
  }

  return `Sync complete. ${imported} ${details}`;
}
