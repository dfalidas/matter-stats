import { MatterBudgetStop } from "./matter-invocation-budget";

// Application policy, not upstream requirements. Every retry re-enters admission.
export const MATTER_RETRY_MAX_ATTEMPTS = 3;
export const MATTER_RETRY_BASE_MS = 500;
export const MATTER_RETRY_JITTER_MS = 250;
export const MATTER_RETRY_MAX_DELAY_MS = 2_000;
export const MATTER_MAX_SHORT_WAIT_MS = 2_000;
export const MATTER_RETRY_RECOVERY_MS = 15 * 60_000;
export const MATTER_429_FALLBACK_MS = 60_000;
export const MATTER_MAX_TIMESTAMP_MS = 253402300799000; // end of year 9999
const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"]);
export function isTransientMatterFailure(error: unknown): boolean {
  if (error instanceof MatterBudgetStop) return error.reason === "timeout";
  if (!error || typeof error !== "object") return false;
  if ("status" in error) return [500, 502, 503, 504].includes(Number(error.status));
  const cause = "cause" in error && error.cause && typeof error.cause === "object" ? error.cause : error;
  return "code" in cause && typeof cause.code === "string" && TRANSIENT_CODES.has(cause.code);
}
export function matterRetryDelay(attempt: number, random: () => number = Math.random): number {
  const sample = random();
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MATTER_RETRY_MAX_ATTEMPTS || !Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error("Invalid Matter retry policy input");
  return Math.min(MATTER_RETRY_MAX_DELAY_MS, MATTER_RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(sample * (MATTER_RETRY_JITTER_MS + 1)));
}
export function strictMatterInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 && result <= 1_000_000 ? result : null;
}
export function strictMatterReset(value: string | null, now: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds * 1000 > now && seconds * 1000 <= MATTER_MAX_TIMESTAMP_MS ? seconds : null;
}
export function matterCooldownDeadline(retrySeconds: number | null, resetSeconds: number | null, now: number): number {
  return Math.max(now + (retrySeconds === null ? MATTER_429_FALLBACK_MS : Math.max(1_000, retrySeconds * 1000)), resetSeconds === null ? 0 : resetSeconds * 1000);
}
export class MatterRequestDeferred extends Error {
  constructor(readonly reason: "quota" | "retry" | "exhausted", readonly nextAt: string) {
    super(reason === "exhausted" ? "Matter automatic retry chain exhausted. Deliberate manual recovery is eligible after the recorded 15-minute deadline." : "Matter request deferred until its durable eligibility deadline.");
    this.name = "MatterRequestDeferred";
  }
}
