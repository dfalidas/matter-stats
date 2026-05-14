"use server";

import { revalidatePath } from "next/cache";

import { syncMatterData, type MatterSyncResult } from "@/lib/matter-sync";

export type SyncMatterActionState = MatterSyncResult | null;

export async function syncMatterAction(previousState: SyncMatterActionState): Promise<MatterSyncResult> {
  void previousState;

  const result = await syncMatterData();

  revalidatePath("/dashboard");
  revalidatePath("/articles");
  revalidatePath("/reports");
  revalidatePath("/sources");
  revalidatePath("/authors");
  revalidatePath("/tags");
  revalidatePath("/year-in-reading");

  return result;
}
