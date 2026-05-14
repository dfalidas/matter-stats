import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";
import type { Database, TablesInsert, TablesUpdate } from "@/lib/supabase-types";

export type SupabaseAdminClient = SupabaseClient<Database>;

let supabaseAdminClient: SupabaseAdminClient | null = null;

export function createSupabaseAdminClient(): SupabaseAdminClient {
  return createClient<Database>(serverEnv.supabase.url, serverEnv.supabase.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function getSupabaseAdminClient(): SupabaseAdminClient {
  supabaseAdminClient ??= createSupabaseAdminClient();
  return supabaseAdminClient;
}

export async function upsertMatterItems(items: TablesInsert<"matter_items">[]) {
  if (items.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("matter_items")
    .upsert(items, { onConflict: "id" })
    .select();

  if (error) {
    throw error;
  }

  return data;
}

export async function upsertReadingSessions(sessions: TablesInsert<"reading_sessions">[]) {
  if (sessions.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("reading_sessions")
    .upsert(sessions, { onConflict: "id" })
    .select();

  if (error) {
    throw error;
  }

  return data;
}

export async function upsertMatterTags(tags: TablesInsert<"matter_tags">[]) {
  if (tags.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("matter_tags")
    .upsert(tags, { onConflict: "id" })
    .select();

  if (error) {
    throw error;
  }

  return data;
}

export async function upsertItemTags(itemTags: TablesInsert<"item_tags">[]) {
  if (itemTags.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("item_tags")
    .upsert(itemTags, { onConflict: "item_id,tag_id" })
    .select();

  if (error) {
    throw error;
  }

  return data;
}

export async function upsertAnnotations(annotations: TablesInsert<"annotations">[]) {
  if (annotations.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("annotations")
    .upsert(annotations, { onConflict: "id" })
    .select();

  if (error) {
    throw error;
  }

  return data;
}

export async function upsertDailyStats(stats: TablesInsert<"daily_stats">[]) {
  if (stats.length === 0) {
    return [];
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("daily_stats")
    .upsert(stats, { onConflict: "date" })
    .select();

  if (error) {
    throw error;
  }

  return data;
}

export async function getLatestSuccessfulSyncCheckpoint(): Promise<string | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("sync_runs")
    .select("checkpoint_timestamp")
    .eq("status", "success")
    .not("checkpoint_timestamp", "is", null)
    .order("finished_at", { ascending: false, nullsFirst: false })
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.checkpoint_timestamp ?? null;
}

export async function createSyncRun(syncRun: TablesInsert<"sync_runs">) {
  const { data, error } = await getSupabaseAdminClient().from("sync_runs").insert(syncRun).select().single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateSyncRun(id: string, syncRun: TablesUpdate<"sync_runs">) {
  const { data, error } = await getSupabaseAdminClient().from("sync_runs").update(syncRun).eq("id", id).select().single();

  if (error) {
    throw error;
  }

  return data;
}
