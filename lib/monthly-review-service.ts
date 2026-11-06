import type { MatterStatsSupabaseClient } from "./supabase-queries";
import type { AnalyticsQueryContext } from "./analytics-query-context";
import { localDateToUtc, timestampToCalendarDate } from "./calendar";
import { readStatusEvidence } from "./sync-status";
import {
  canonicalSeconds,
  monthState,
  reviewAnomalies,
  type ReviewCoverage,
} from "./monthly-review";

/** Same independent continuation/stream/retry evidence as synchronization status.
 * Absence/exhaustion never upgrades unverified upstream history to complete. */
export async function loadReviewCoverage(
  client: MatterStatsSupabaseClient,
  now: Date,
): Promise<ReviewCoverage> {
  const [streams, continuation, retry] = await Promise.all([
    readStatusEvidence(
      client.from("matter_sync_streams").select("stream,cycle_active").limit(2),
    ),
    readStatusEvidence(
      client
        .from("matter_sync_continuation")
        .select("history_status")
        .eq("account_scope", "matter")
        .single(),
    ),
    readStatusEvidence(
      client.rpc("read_matter_retry_status", { p_now: now.toISOString() }),
    ),
  ]);
  const streamRows =
    streams.state === "known" && Array.isArray(streams.value)
      ? streams.value
      : null;
  const history =
    continuation.state === "known" ? continuation.value.history_status : null;
  const retryValue =
    retry.state === "known" &&
    typeof retry.value === "object" &&
    !Array.isArray(retry.value)
      ? retry.value
      : null;
  if (
    streamRows?.some((row) => row.cycle_active === true) ||
    history === "pending" ||
    history === "running" ||
    (retryValue &&
      ((typeof retryValue.pendingRequests === "number" &&
        retryValue.pendingRequests > 0) ||
        retryValue.manualRecovery === true))
  )
    return "incomplete";
  if (
    !streamRows ||
    !["recent_sessions", "library_items"].every((name) =>
      streamRows.some(
        (row) => row.stream === name && typeof row.cycle_active === "boolean",
      ),
    ) ||
    (history !== "none" && history !== "complete") ||
    !retryValue ||
    !Number.isSafeInteger(retryValue.pendingRequests) ||
    Number(retryValue.pendingRequests) < 0 ||
    typeof retryValue.manualRecovery !== "boolean"
  )
    return "unavailable";
  return "unknown";
}

export async function loadMonthlyTrend(
  context: AnalyticsQueryContext,
  year: number,
  now: Date,
  timezone: string,
) {
  try {
    const rows = await context.sessions(
      localDateToUtc(year, 1, 1, timezone),
      localDateToUtc(year + 1, 1, 1, timezone),
      "streak",
    );
    const totals = new Map<string, number>();
    for (const row of rows) {
      const key = timestampToCalendarDate(row.started_at!, timezone).slice(
        0,
        7,
      );
      totals.set(
        key,
        (totals.get(key) ?? 0) + canonicalSeconds(row.duration_seconds),
      );
    }
    return {
      ok: true as const,
      year,
      anomalies: reviewAnomalies(rows, now),
      months: Array.from({ length: 12 }, (_, index) => {
        const month = `${year}-${String(index + 1).padStart(2, "0")}`;
        return {
          month,
          seconds: totals.get(month) ?? 0,
          state: monthState(month, now, timezone),
        };
      }),
    };
  } catch {
    return { ok: false as const, year };
  }
}
