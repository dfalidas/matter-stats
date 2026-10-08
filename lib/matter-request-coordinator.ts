import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase-admin";
import { leaseRpcArgs, MatterSyncLeaseLostError, type MatterSyncLease } from "./matter-sync-lease-context";
import { getMatterInvocationBudget } from "./matter-invocation-budget";
import { MatterRequestDeferred, MATTER_MAX_SHORT_WAIT_MS, MATTER_RETRY_MAX_ATTEMPTS } from "./matter-request-policy";
import type { Json, TablesInsert } from "./supabase-types";

export type MatterRequestEntry = { value?: Json; status?: number; protocol?: boolean; attempts?: number; sequence?: string };
export type MatterAdmission = { admitted: boolean; reason?: "quota" | "retry" | "exhausted" | "cached"; next_at?: string; entry?: MatterRequestEntry; sequence?: string; attempt?: number };
export type MatterRequestStore = {
  admit: (args: { p_slot: string; p_key: string; p_markdown: boolean; p_recover: boolean; p_lease: Json | null }) => Promise<MatterAdmission>;
  finish: (args: { p_slot: string; p_key: string; p_sequence: string; p_entry: Json; p_lease: Json | null }) => Promise<void>;
  feedback: (args: { p_sequence: string; p_limit: number | null; p_remaining: number | null; p_reset: string | null; p_cooldown: string | null }) => Promise<void>;
};
async function checkedRpc<T>(name: "admit_matter_request" | "finish_matter_request" | "feedback_matter_request", args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdminClient().rpc(name, args as never);
  if (error?.code === "55000") throw new MatterSyncLeaseLostError();
  if (error) throw error;
  return data as T;
}
const productionStore: MatterRequestStore = {
  admit: (args) => checkedRpc("admit_matter_request", args),
  finish: (args) => checkedRpc("finish_matter_request", args),
  feedback: (args) => checkedRpc("feedback_matter_request", args),
};
export async function prepareMatterRequestWork(expected: TablesInsert<"matter_sync_streams">, lease: MatterSyncLease): Promise<void> {
  const { error } = await getSupabaseAdminClient().rpc("prepare_matter_request_work", { ...leaseRpcArgs(lease), p_expected: expected as Json });
  if (error?.code === "55000") throw new MatterSyncLeaseLostError();
  if (error) throw error;
}
type Context = { slot: string; lease?: MatterSyncLease; recover: boolean };
const contexts = new AsyncLocalStorage<Context>();
export const withMatterRequestContext = <T>(context: Context, work: () => Promise<T>) => contexts.run(context, work);
export type MatterRequestRuntime = { store: MatterRequestStore; now: () => number; random: () => number; wait: (ms: number, signal?: AbortSignal) => Promise<void> };
async function wait(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
const runtimes = new AsyncLocalStorage<MatterRequestRuntime>();
const productionRuntime = { store: productionStore, now: Date.now, random: Math.random, wait };
export const withMatterRequestRuntime = <T>(runtime: MatterRequestRuntime, work: () => Promise<T>) => runtimes.run(runtime, work);
export const getMatterRequestRuntime = () => runtimes.getStore() ?? productionRuntime;
export function matterRequestIdentity(url: URL) {
  const context = contexts.getStore();
  return { p_slot: context?.slot ?? "bootstrap", p_key: createHash("sha256").update(url.href).digest("hex"), p_recover: context?.recover ?? false,
    p_lease: context?.lease ? leaseRpcArgs(context.lease) as Json : null };
}
export async function admitMatterRequest(url: URL, beforeRequest?: () => Promise<void>, signal?: AbortSignal, waitBudget = { remainingMs: MATTER_MAX_SHORT_WAIT_MS }): Promise<MatterAdmission> {
  const runtime = getMatterRequestRuntime();
  const args = { ...matterRequestIdentity(url), p_markdown: (url.searchParams.get("include") ?? "").split(",").includes("markdown") };
  for (;;) {
    signal?.throwIfAborted();
    getMatterInvocationBudget()?.checkRequest();
    await beforeRequest?.();
    const admission = await runtime.store.admit(args);
    if (!admission || typeof admission.admitted !== "boolean") throw new Error("Unverified Matter admission");
    if (admission.admitted) {
      if (!admission.sequence || !/^\d+$/.test(admission.sequence) || !Number.isInteger(admission.attempt) || admission.attempt! < 1 || admission.attempt! > MATTER_RETRY_MAX_ATTEMPTS) throw new Error("Unverified Matter reservation");
      return admission;
    }
    if (admission.reason === "cached" && admission.entry && ("value" in admission.entry || admission.entry.protocol === true || (Number.isInteger(admission.entry.status) && admission.entry.status! >= 400 && admission.entry.status! <= 599))) return admission;
    if (!["quota", "retry", "exhausted"].includes(admission.reason ?? "") || !admission.next_at || !Number.isFinite(Date.parse(admission.next_at))) throw new Error("Unverified Matter refusal");
    const delay = Math.max(0, Date.parse(admission.next_at) - runtime.now());
    if (admission.reason === "exhausted" || Math.max(1, delay) > waitBudget.remainingMs) throw new MatterRequestDeferred(admission.reason as "quota" | "retry" | "exhausted", admission.next_at);
    getMatterInvocationBudget()?.checkWait(delay);
    const waitMs = Math.max(1, delay);
    waitBudget.remainingMs -= waitMs;
    await runtime.wait(waitMs, signal);
    await beforeRequest?.();
  }
}
