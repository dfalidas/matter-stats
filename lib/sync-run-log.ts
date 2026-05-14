import type { SyncRun } from "@/lib/supabase-types";

export type SyncRunLogEntry = Pick<
  SyncRun,
  "id" | "started_at" | "finished_at" | "status" | "items_synced" | "sessions_synced" | "error_message"
>;

const MAX_SAFE_ERROR_LENGTH = 280;
const SENSITIVE_FIELD_PATTERN = /\b(authorization|bearer|token|api[-_\s]?key|password|secret)\b\s*[:=]\s*["']?[^\s,"')]+/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const LONG_SECRET_PATTERN = /\b[A-Za-z0-9_+/-]{32,}={0,2}\b/g;

export function sanitizeSyncRunErrorMessage(message: string | null | undefined): string {
  if (!message || message.trim().length === 0) {
    return "No error message recorded.";
  }

  const redacted = message
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(JWT_PATTERN, "[redacted token]")
    .replace(SENSITIVE_FIELD_PATTERN, (match) => {
      const separator = match.includes(":") ? ":" : "=";
      const [label] = match.split(separator);
      return `${label.trim()}${separator} [redacted]`;
    })
    .replace(LONG_SECRET_PATTERN, "[redacted token]")
    .replace(/\s+/g, " ")
    .trim();

  if (redacted.length <= MAX_SAFE_ERROR_LENGTH) {
    return redacted;
  }

  return `${redacted.slice(0, MAX_SAFE_ERROR_LENGTH - 1).trimEnd()}…`;
}
