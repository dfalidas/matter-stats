"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { ACCESS_COOKIE_NAME, isValidAccessToken } from "@/lib/auth-cookie";
import { getMatterSyncAvailability, syncMatterData, type MatterSyncResult } from "@/lib/matter-sync";
import { normalizeRecentActivityWindow, type MatterSyncMode } from "@/lib/matter-sync-progress";

export type SyncMatterActionState = MatterSyncResult | null;

export async function getMatterSyncAvailabilityAction() {
  const cookieStore = await cookies();
  const hasAccess = await isValidAccessToken(cookieStore.get(ACCESS_COOKIE_NAME)?.value);

  if (!hasAccess) {
    return { rateLimitedUntil: null, message: null };
  }

  return getMatterSyncAvailability();
}

export async function syncMatterAction(previousState: SyncMatterActionState, formData?: FormData): Promise<MatterSyncResult> {
  void previousState;
  const mode = parseSyncMode(formData?.get("mode"));
  const recentActivityWindow = normalizeRecentActivityWindow(formData?.get("recentActivityWindow"));

  const cookieStore = await cookies();
  const hasAccess = await isValidAccessToken(cookieStore.get(ACCESS_COOKIE_NAME)?.value);

  if (!hasAccess) {
    return {
      ok: false,
      message: "Your session expired. Sign in again before syncing Matter.",
    };
  }

  const result = await syncMatterData(mode, { recentActivityWindow });

  revalidatePath("/dashboard");
  revalidatePath("/articles");
  revalidatePath("/reports");
  revalidatePath("/sources");
  revalidatePath("/authors");
  revalidatePath("/tags");
  revalidatePath("/year-in-reading");
  revalidatePath("/settings");

  return result;
}

function parseSyncMode(value: FormDataEntryValue | null | undefined): MatterSyncMode {
  return value === "backfill_library" ? "backfill_library" : "recent_activity_manual";
}
