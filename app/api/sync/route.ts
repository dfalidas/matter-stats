import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { syncMatterLibrary } from "@/lib/matter/client";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST() {
  try {
    const result = await syncMatterLibrary();
    const env = getServerEnv();

    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.from("sync_state").upsert({
        id: "matter",
        provider: "matter",
        cursor: result.nextCursor,
        last_synced_at: new Date().toISOString(),
        metadata: {
          importedArticles: result.importedArticles,
          importedSessions: result.importedSessions,
          importedHighlights: result.importedHighlights,
        },
      });

      if (error) {
        throw new Error("Matter sync completed, but sync state could not be stored.");
      }
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
