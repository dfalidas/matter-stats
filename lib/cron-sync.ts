import type { MatterSyncResult } from "./matter-sync";

export type CronSyncDeps = {
  cronSecret: string | undefined;
  syncRecentActivity: () => Promise<MatterSyncResult>;
};

function getProvidedSecret(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

export async function handleRecentActivityCron(request: Request, deps: CronSyncDeps): Promise<Response> {
  const expectedSecret = deps.cronSecret?.trim();
  const providedSecret = getProvidedSecret(request);

  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const syncMode = "recent_activity_scheduled";

  // All account checks and writes belong to the leased runtime, after auth.
  const result = await deps.syncRecentActivity();
  if (result.skippedReason) {
    return Response.json({
      ok: true,
      status: "skipped",
      sync_mode: syncMode,
      sessions_synced: 0,
      matter_sessions_returned: 0,
      skipped_reason: result.skippedReason,
      rate_limited_until: result.rateLimitedUntil ?? null,
    });
  }

  return Response.json(
    {
      ok: result.ok,
      status: result.ok ? result.status === "partial" ? "partial" : "success" : "error",
      sync_mode: syncMode,
      sessions_synced: result.sessionsSynced ?? 0,
      matter_sessions_returned: result.sessionsSynced ?? 0,
      skipped_reason: null,
      has_more: result.hasMore ?? false,
      pages_committed: result.pagesCommitted ?? 0,
      requests_attempted: result.requestsAttempted ?? 0,
      history_status: result.historyStatus ?? null,
      message: result.message,
    },
    { status: result.ok ? 200 : 500 }
  );
}
