import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase-admin";
import { leaseRpcArgs, MatterSyncLeaseLostError, type MatterSyncLease } from "./matter-sync-lease-context";

// DB accepts only 30–300 seconds. Renew at every HTTP boundary and write batch.
export const MATTER_SYNC_LEASE_TTL_SECONDS = 120;

export async function acquireMatterSyncLease(owner: string = randomUUID()): Promise<MatterSyncLease | null> {
  // The invocation UUID also identifies its audit and fenced run. Ownership
  // still requires the database-issued generation and a live lease.
  const { data, error } = await getSupabaseAdminClient().rpc("acquire_matter_sync_lease", {
    p_account_scope: "matter", p_owner: owner, p_ttl_seconds: MATTER_SYNC_LEASE_TTL_SECONDS,
  });
  if (error) throw error;
  if (!Array.isArray(data) || data.length > 1) throw new Error("Invalid lease acquisition response");
  if (data.length === 0) return null;
  const lease: MatterSyncLease = { accountScope: "matter", owner, generation: data[0].generation };
  leaseRpcArgs(lease);
  return lease;
}

export async function renewMatterSyncLease(lease: MatterSyncLease): Promise<void> {
  const { data, error } = await getSupabaseAdminClient().rpc("renew_matter_sync_lease", {
    ...leaseRpcArgs(lease), p_ttl_seconds: MATTER_SYNC_LEASE_TTL_SECONDS,
  });
  if (error) throw error;
  if (data !== true) throw new MatterSyncLeaseLostError();
}

export async function releaseMatterSyncLease(lease: MatterSyncLease): Promise<boolean> {
  const { data, error } = await getSupabaseAdminClient().rpc("release_matter_sync_lease", leaseRpcArgs(lease));
  if (error) throw error;
  if (typeof data !== "boolean") throw new Error("Invalid lease release response");
  return data;
}
