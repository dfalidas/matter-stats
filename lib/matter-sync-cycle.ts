import type { Json, MatterSyncStream, TablesInsert } from "./supabase-types";

export const MATTER_SYNC_OVERLAP_DAYS = 7;
export type MatterSyncStreamName = "recent_sessions" | "library_items";

export type ActiveMatterCycle = {
  stream: MatterSyncStreamName;
  endpoint: "/reading_sessions" | "/items";
  filters: Record<string, string>;
  pageLimit: number;
  cursor: string | null;
  cycleStartedAt: string;
  cycleGeneration: number;
  completedWatermark: string | null;
  transitionStatus: string;
  coverageWindow: string | null;
};

export function startOrResumeMatterCycle(args: {
  stream: MatterSyncStreamName;
  stored: MatterSyncStream | null;
  now: Date;
  configuredLimit: number;
  initialSince?: string | null;
  requestedWindow?: string | null;
}): ActiveMatterCycle {
  const expectedEndpoint = args.stream === "recent_sessions" ? "/reading_sessions" : "/items";
  if (args.stored?.cycle_active) {
    if (args.stored.endpoint !== expectedEndpoint || !args.stored.cycle_started_at) {
      throw new Error("Stored Matter cycle contract is incompatible; an explicit recoverable restart is required.");
    }
    const filters = readFilters(args.stored.filters);
    validateFilters(args.stream, filters);
    return {
      stream: args.stream,
      endpoint: expectedEndpoint,
      filters,
      pageLimit: args.stored.page_limit,
      cursor: args.stored.cursor,
      cycleStartedAt: args.stored.cycle_started_at,
      cycleGeneration: args.stored.cycle_generation,
      completedWatermark: args.stored.completed_watermark,
      transitionStatus: args.stored.transition_status,
      coverageWindow: args.stored.coverage_window,
    };
  }

  const since = args.stored?.completed_watermark
    ? subtractDays(args.stored.completed_watermark, MATTER_SYNC_OVERLAP_DAYS)
    : args.initialSince ?? null;
  const filters: Record<string, string> = args.stream === "recent_sessions"
    ? (since ? { since } : {})
    : { status: "all", order: "updated", ...(since ? { updated_since: since } : {}) };

  return {
    stream: args.stream,
    endpoint: expectedEndpoint,
    filters,
    pageLimit: args.configuredLimit,
    cursor: null,
    cycleStartedAt: args.now.toISOString(),
    cycleGeneration: (args.stored?.cycle_generation ?? 0) + 1,
    completedWatermark: args.stored?.completed_watermark ?? null,
    transitionStatus: "native",
    coverageWindow: args.stream === "recent_sessions" ? args.requestedWindow ?? args.stored?.coverage_window ?? null : null,
  };
}

export function persistActiveMatterCycle(cycle: ActiveMatterCycle, cursor: string | null, retryAt: string | null = null): TablesInsert<"matter_sync_streams"> {
  return {
    stream: cycle.stream,
    endpoint: cycle.endpoint,
    filters: cycle.filters as Json,
    page_limit: cycle.pageLimit,
    cursor,
    cycle_started_at: cycle.cycleStartedAt,
    cycle_generation: cycle.cycleGeneration,
    completed_watermark: cycle.completedWatermark,
    retry_at: retryAt,
    cycle_active: true,
    transition_status: cycle.transitionStatus,
    coverage_window: cycle.coverageWindow,
  };
}

export function completeMatterCycle(cycle: ActiveMatterCycle): TablesInsert<"matter_sync_streams"> {
  return {
    ...persistActiveMatterCycle(cycle, null),
    cursor: null,
    cycle_started_at: null,
    completed_watermark: cycle.cycleStartedAt,
    retry_at: null,
    cycle_active: false,
    transition_status: "native",
  };
}

function readFilters(value: Json): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored Matter cycle filters are invalid; an explicit recoverable restart is required.");
  }
  const filters: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") throw new Error("Stored Matter cycle filters are invalid; an explicit recoverable restart is required.");
    filters[key] = entry;
  }
  return filters;
}

function validateFilters(stream: MatterSyncStreamName, filters: Record<string, string>): void {
  const keys = Object.keys(filters).sort();
  if (stream === "recent_sessions") {
    if (keys.some((key) => key !== "since")) {
      throw new Error("Stored Matter cycle filters are incompatible; an explicit recoverable restart is required.");
    }
    return;
  }
  if (filters.status !== "all" || filters.order !== "updated" || keys.some((key) => !["order", "status", "updated_since"].includes(key))) {
    throw new Error("Stored Matter cycle filters are incompatible; an explicit recoverable restart is required.");
  }
}

function subtractDays(timestamp: string, days: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Stored Matter completed watermark is invalid.");
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}
