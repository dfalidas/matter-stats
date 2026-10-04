import type { MatterSyncResult } from "@/lib/matter-sync";

export async function getAuthorizedSyncAvailability(deps: {
  authorize: () => Promise<boolean>;
  getAvailability: () => Promise<{ rateLimitedUntil: string | null; message: string | null }>;
}) {
  if (!await deps.authorize()) return { rateLimitedUntil: null, message: null };
  return deps.getAvailability();
}

export async function runAuthorizedSync(deps: {
  authorize: () => Promise<boolean>;
  sync: () => Promise<MatterSyncResult>;
  afterSync?: () => void;
}): Promise<MatterSyncResult> {
  if (!await deps.authorize()) return { ok: false, message: "Your session expired. Sign in again before syncing Matter." };
  const result = await deps.sync();
  deps.afterSync?.();
  return result;
}
