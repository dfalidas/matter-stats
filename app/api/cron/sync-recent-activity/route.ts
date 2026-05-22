import { handleRecentActivityCron } from "@/lib/cron-sync";
import { getMatterSyncAvailability, syncMatterData } from "@/lib/matter-sync";
import { createSyncRun, updateSyncRun } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRecentActivityCron(request, {
    cronSecret: process.env.CRON_SECRET,
    syncRecentActivity: () => syncMatterData("recent_activity"),
    getAvailability: getMatterSyncAvailability,
    createRun: createSyncRun,
    updateRun: updateSyncRun,
    now: () => new Date(),
  });
}
