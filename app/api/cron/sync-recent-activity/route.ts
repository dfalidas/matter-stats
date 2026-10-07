import { handleRecentActivityCron } from "@/lib/cron-sync";
import { syncMatterData } from "@/lib/matter-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request): Promise<Response> {
  return handleRecentActivityCron(request, {
    cronSecret: process.env.CRON_SECRET,
    syncRecentActivity: () => syncMatterData("recent_activity_scheduled"),
  });
}
