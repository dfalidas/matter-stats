"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { ACCESS_COOKIE_NAME, isValidAccessToken } from "@/lib/auth-cookie";
import { getMatterSyncAvailability, syncMatterData, type MatterSyncResult } from "@/lib/matter-sync";
import { normalizeRecentActivityWindow, type MatterSyncMode } from "@/lib/matter-sync-progress";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getAuthorizedSyncAvailability, runAuthorizedSync } from "@/lib/dashboard-actions";
import { authorizeAccessSession } from "@/lib/access-control";

export type SyncMatterActionState = MatterSyncResult | null;

export async function getMatterSyncAvailabilityAction() {
  return getAuthorizedSyncAvailability({ authorize: authorizeAction, getAvailability: getMatterSyncAvailability });
}

export async function syncMatterAction(previousState: SyncMatterActionState, formData?: FormData): Promise<MatterSyncResult> {
  void previousState;
  const mode = parseSyncMode(formData?.get("mode"));
  const recentActivityWindow = normalizeRecentActivityWindow(formData?.get("recentActivityWindow"));

  const result = await runAuthorizedSync({
    authorize: authorizeAction,
    sync: () => syncMatterData(mode, { recentActivityWindow }),
    afterSync: revalidateDashboardPaths,
  });

  return result;
}

function revalidateDashboardPaths(): void {
  revalidatePath("/dashboard");
  revalidatePath("/articles");
  revalidatePath("/reports");
  revalidatePath("/sources");
  revalidatePath("/authors");
  revalidatePath("/tags");
  revalidatePath("/year-in-reading");
  revalidatePath("/settings");
}

async function authorizeAction(): Promise<boolean> {
  return authorizeAccessSession({
    readToken: async () => (await cookies()).get(ACCESS_COOKIE_NAME)?.value,
    validateToken: (token) => isValidAccessToken(getSupabaseAdminClient(), token),
  });
}

function parseSyncMode(value: FormDataEntryValue | null | undefined): MatterSyncMode {
  return value === "backfill_library" ? "backfill_library" : "recent_activity_manual";
}
