const DEFAULT_MATTER_SYNC_ITEMS_LIMIT = 25;
const DEFAULT_MATTER_SYNC_SESSIONS_LIMIT = 25;

export const MATTER_SYNC_BATCH_LIMIT = DEFAULT_MATTER_SYNC_ITEMS_LIMIT;

export type MatterSyncPhase = "items" | "tags" | "sessions" | "complete";
export type MatterSyncMode = "recent_activity" | "backfill_library";

export const DEFAULT_MATTER_SYNC_MODE: MatterSyncMode = "recent_activity";

export type MatterBatchCounts = {
  items: number;
  sessions: number;
  annotations: number;
  tags: number;
};

type MatterSyncLimitEnv = { [key: string]: string | undefined };

export type MatterSyncButtonState = {
  isPending: boolean;
  rateLimitedUntil?: string | null;
  now?: Date;
};

export function getMatterSyncItemsLimit(env: MatterSyncLimitEnv = process.env): number {
  return parseMatterSyncLimit(env.MATTER_SYNC_ITEMS_LIMIT, DEFAULT_MATTER_SYNC_ITEMS_LIMIT);
}

export function getMatterSyncSessionsLimit(env: MatterSyncLimitEnv = process.env): number {
  return parseMatterSyncLimit(env.MATTER_SYNC_SESSIONS_LIMIT, DEFAULT_MATTER_SYNC_SESSIONS_LIMIT);
}

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

export function buildMatterSyncMessage(
  counts: MatterBatchCounts,
  hasMore: boolean,
  mode: MatterSyncMode = DEFAULT_MATTER_SYNC_MODE
): string {
  const modeLabel = mode === "backfill_library" ? "Backfill library" : "Recent activity sync";
  const imported = `Imported ${counts.sessions} sessions, ${counts.items} linked items, ${counts.annotations} annotations, and ${counts.tags} tags.`;

  if (hasMore) {
    return `${modeLabel} started. ${imported} More ${mode === "backfill_library" ? "library data" : "recent activity"} remains — click Sync again.`;
  }

  return `${modeLabel} complete. ${imported}`;
}

export function getMatterSyncInitialPhase(mode: MatterSyncMode): MatterSyncPhase {
  return mode === "backfill_library" ? "items" : "sessions";
}

export function getRecentActivityWindowStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0)).toISOString();
}

export function collectLinkedMatterItemIds(sessions: Array<{ item_id?: string | null }>): string[] {
  return [...new Set(sessions.map((session) => session.item_id?.trim()).filter(isNonEmptyString))];
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}


export function parseRetryAfterHeader(value: string | null, now: number = Date.now()): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) {
    return Math.max(seconds, 0);
  }

  const retryAt = Date.parse(value);
  if (Number.isFinite(retryAt)) {
    return Math.max(Math.ceil((retryAt - now) / 1_000), 0);
  }

  return null;
}


export type MatterSyncStateSnapshot = {
  completed_checkpoint_timestamp: string | null;
  active_since_timestamp: string | null;
  active_phase: MatterSyncPhase | string;
  item_cursor: string | null;
  tag_cursor: string | null;
  session_cursor: string | null;
  next_checkpoint_timestamp: string | null;
  sync_mode?: MatterSyncMode | string;
  recent_activity_checkpoint?: string | null;
  backfill_items_cursor?: string | null;
};

export function buildRateLimitedMatterSyncState<T extends MatterSyncStateSnapshot>(
  storedState: T | null,
  rateLimitedUntil: string
): MatterSyncStateSnapshot & { id: "matter"; rate_limited_until: string } {
  return {
    id: "matter",
    completed_checkpoint_timestamp: storedState?.completed_checkpoint_timestamp ?? null,
    active_since_timestamp: storedState?.active_since_timestamp ?? null,
    active_phase: storedState?.active_phase ?? "complete",
    item_cursor: storedState?.item_cursor ?? null,
    tag_cursor: storedState?.tag_cursor ?? null,
    session_cursor: storedState?.session_cursor ?? null,
    next_checkpoint_timestamp: storedState?.next_checkpoint_timestamp ?? null,
    rate_limited_until: rateLimitedUntil,
    sync_mode: storedState?.sync_mode ?? DEFAULT_MATTER_SYNC_MODE,
    recent_activity_checkpoint: storedState?.recent_activity_checkpoint ?? null,
    backfill_items_cursor: storedState?.backfill_items_cursor ?? null,
  };
}

export function buildMatterRateLimitMessage(rateLimitedUntil: string | null): string {
  return `Matter rate limit reached. Try again after ${formatMatterRetryTime(rateLimitedUntil)}.`;
}

export function isMatterRateLimitActive(rateLimitedUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!rateLimitedUntil) {
    return false;
  }

  const retryAt = Date.parse(rateLimitedUntil);
  return Number.isFinite(retryAt) && retryAt > now.getTime();
}

export function shouldDisableMatterSyncButton({ isPending, rateLimitedUntil, now = new Date() }: MatterSyncButtonState): boolean {
  return isPending || isMatterRateLimitActive(rateLimitedUntil, now);
}

export function formatMatterRetryTime(rateLimitedUntil: string | null): string {
  if (!rateLimitedUntil) {
    return "the time Matter provides";
  }

  const retryAt = new Date(rateLimitedUntil);
  if (!Number.isFinite(retryAt.getTime())) {
    return "the time Matter provides";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(retryAt);
}

function parseMatterSyncLimit(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}
