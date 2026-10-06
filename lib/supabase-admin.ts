import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";
import { leaseRpcArgs, MatterSyncLeaseLostError, type MatterSyncLease } from "./matter-sync-lease-context";
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

export async function upsertMatterItems(rows: TablesInsert<"matter_items">[], lease: MatterSyncLease) {
  const args = leaseRpcArgs(lease);
  if (rows.length === 0) return [];
  const { data, error } = await getSupabaseAdminClient().rpc("sync_upsert_matter_items", { ...args, p_rows: rows });
  if (error?.code === "55000") throw new MatterSyncLeaseLostError();
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Missing fenced mutation response");
  return data;
}

export async function upsertReadingSessions(rows: TablesInsert<"reading_sessions">[], lease: MatterSyncLease) {
  const args = leaseRpcArgs(lease);
  if (rows.length === 0) return [];
  const { data, error } = await getSupabaseAdminClient().rpc("sync_upsert_reading_sessions", { ...args, p_rows: rows });
  if (error?.code === "55000") throw new MatterSyncLeaseLostError();
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Missing fenced mutation response");
  return data;
}

export async function upsertMatterTags(rows: TablesInsert<"matter_tags">[], lease: MatterSyncLease) {
  const args = leaseRpcArgs(lease);
  if (rows.length === 0) return [];
  const { data, error } = await getSupabaseAdminClient().rpc("sync_upsert_matter_tags", { ...args, p_rows: rows });
  if (error?.code === "55000") throw new MatterSyncLeaseLostError();
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Missing fenced mutation response");
  return data;
}

export async function upsertAnnotations(rows: TablesInsert<"annotations">[], lease: MatterSyncLease) {
  const args = leaseRpcArgs(lease);
  if (rows.length === 0) return [];
  const { data, error } = await getSupabaseAdminClient().rpc("sync_upsert_annotations", { ...args, p_rows: rows });
  if (error?.code === "55000") throw new MatterSyncLeaseLostError();
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Missing fenced mutation response");
  return data;
}

export async function upsertDailyStats(rows: TablesInsert<"daily_stats">[], lease: MatterSyncLease) {
  const args = leaseRpcArgs(lease);
  if (rows.length === 0) return [];
  const { data, error } = await getSupabaseAdminClient().rpc("sync_upsert_daily_stats", { ...args, p_rows: rows });
  if (error?.code === "55000") throw new MatterSyncLeaseLostError();
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Missing fenced mutation response");
  return data;
}

export async function replaceMatterItemTags(itemIds: string[], rows: TablesInsert<"item_tags">[], lease: MatterSyncLease) {
  const { error } = await getSupabaseAdminClient().rpc("sync_replace_item_tags", {
    ...leaseRpcArgs(lease), p_item_ids: itemIds, p_rows: rows,
  });
  if (error?.code === "55000") throw new MatterSyncLeaseLostError();
  if (error) throw error;
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

export async function getMatterSyncState() {
  const { data, error } = await getSupabaseAdminClient()
    .from("sync_state")
    .select("*")
    .eq("id", "matter")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function getMatterSyncStream(stream: "recent_sessions" | "library_items") {
  const { data, error } = await getSupabaseAdminClient()
    .from("matter_sync_streams")
    .select("*")
    .eq("stream", stream)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMatterSyncStreams() {
  const { data, error } = await getSupabaseAdminClient().from("matter_sync_streams").select("*");
  if (error) throw error;
  return data;
}

export async function upsertMatterSyncStream(state: TablesInsert<"matter_sync_streams">, lease: MatterSyncLease) {
  const { data, error } = await getSupabaseAdminClient().rpc("sync_upsert_stream", { ...leaseRpcArgs(lease), p_state: state });
  if (error?.code === "55000") throw new MatterSyncLeaseLostError();
  if (error) throw error;
  if (!data) throw new Error("Missing fenced stream response");
  return data;
}

export async function createSyncRun(syncRun: TablesInsert<"sync_runs">, lease: MatterSyncLease) {
  const { data, error } = await getSupabaseAdminClient().rpc("sync_create_run", {
    ...leaseRpcArgs(lease), p_started_at: syncRun.started_at ?? new Date().toISOString(), p_sync_mode: syncRun.sync_mode ?? "recent_activity",
  });
  if (error?.code === "55000") throw new MatterSyncLeaseLostError();
  if (error) throw error;
  if (!data) throw new Error("Missing fenced run response");
  return data;
}

export async function updateSyncRun(id: string, syncRun: TablesUpdate<"sync_runs">, lease: MatterSyncLease) {
  const { data, error } = await getSupabaseAdminClient().rpc("sync_update_run", { ...leaseRpcArgs(lease), p_id: id, p_patch: syncRun });
  if (error?.code === "55000") throw new MatterSyncLeaseLostError();
  if (error) throw error;
  if (!data) throw new Error("Missing fenced run response");
  return data;
}
