export type CronSyncDeps = {
  cronSecret: string | undefined;
  syncRecentActivity: () => Promise<{ ok: boolean; message: string; syncRunId?: string }>;
  getAvailability: () => Promise<{ rateLimitedUntil: string | null; message: string | null }>;
  createRun: (values: { status: "running"; started_at: string; sync_mode: string }) => Promise<{ id: string }>;
  updateRun: (id: string, values: Record<string, unknown>) => Promise<{ id: string }>;
  now: () => Date;
};

function getProvidedSecret(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return new URL(request.url).searchParams.get("secret");
}

export async function handleRecentActivityCron(request: Request, deps: CronSyncDeps): Promise<Response> {
  const expectedSecret = deps.cronSecret?.trim();
  const providedSecret = getProvidedSecret(request);

  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const availability = await deps.getAvailability();
  if (availability.rateLimitedUntil) {
    const startedAt = deps.now().toISOString();
    const run = await deps.createRun({ status: "running", started_at: startedAt, sync_mode: "recent_activity_scheduled" });
    await deps.updateRun(run.id, {
      status: "success",
      finished_at: deps.now().toISOString(),
      sync_mode: "recent_activity_scheduled",
      error_message: `Skipped scheduled sync due to active Matter rate limit until ${availability.rateLimitedUntil}.`,
      checkpoint_timestamp: null,
    });
    return Response.json({ ok: true, skipped: true, reason: "rate_limited", rateLimitedUntil: availability.rateLimitedUntil });
  }

  const result = await deps.syncRecentActivity();
  if (result.syncRunId) await deps.updateRun(result.syncRunId, { sync_mode: "recent_activity_scheduled" });
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
