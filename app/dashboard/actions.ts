"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { ACCESS_COOKIE_NAME, isValidAccessToken } from "@/lib/auth-cookie";
import { getMatterSyncAvailability, syncMatterData, type MatterSyncResult } from "@/lib/matter-sync";

export type SyncMatterActionState = MatterSyncResult | null;

export async function getMatterSyncAvailabilityAction() {
  const cookieStore = await cookies();
  const hasAccess = await isValidAccessToken(cookieStore.get(ACCESS_COOKIE_NAME)?.value);

  if (!hasAccess) {
    return { rateLimitedUntil: null, message: null };
  }

  return getMatterSyncAvailability();
}

export async function syncMatterAction(previousState: SyncMatterActionState): Promise<MatterSyncResult> {
  void previousState;

  const cookieStore = await cookies();
  const hasAccess = await isValidAccessToken(cookieStore.get(ACCESS_COOKIE_NAME)?.value);

  if (!hasAccess) {
    return {
      ok: false,
      message: "Your session expired. Sign in again before syncing Matter.",
    };
  }

  const result = await syncMatterData();

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
