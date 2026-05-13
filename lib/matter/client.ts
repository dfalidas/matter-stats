import "server-only";

import { getServerEnv } from "@/lib/env";

export type MatterSyncResult = {
  importedArticles: number;
  importedSessions: number;
  importedHighlights: number;
  nextCursor: string | null;
};

export async function syncMatterLibrary(): Promise<MatterSyncResult> {
  const env = getServerEnv();

  if (!env.MATTER_API_TOKEN) {
    throw new Error("MATTER_API_TOKEN is not configured.");
  }

  // Matter API integration will be implemented against the private server token in a later phase.
  // This placeholder keeps the sync route server-only and establishes the incremental cursor contract.
  return {
    importedArticles: 0,
    importedSessions: 0,
    importedHighlights: 0,
    nextCursor: null,
  };
}
