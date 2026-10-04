import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase-types";

export const ACCESS_COOKIE_NAME = "matter_stats_session";
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;
export const LOGIN_ATTEMPT_LIMIT = 5;

export function accessCookieOptions(token: string, production = process.env.NODE_ENV === "production") {
  return {
    name: ACCESS_COOKIE_NAME,
    value: token,
    httpOnly: true as const,
    secure: production,
    sameSite: "lax" as const,
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  };
}

type AuthClient = SupabaseClient<Database>;

function readAccessPassword(): string {
  const password = process.env.APP_ACCESS_PASSWORD;
  if (!password?.trim()) throw new Error("Missing required server environment variable: APP_ACCESS_PASSWORD.");
  return password;
}

export function readCredentialVersion(): number {
  const value = Number.parseInt(process.env.APP_CREDENTIAL_VERSION ?? "1", 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("APP_CREDENTIAL_VERSION must be a positive integer.");
  }
  return value;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maxLength; index += 1) difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

export function isCorrectAccessPassword(submittedPassword: string): boolean {
  return constantTimeEqual(submittedPassword, readAccessPassword());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function hashAuthValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAccessSession(client: AuthClient, now = new Date()): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(bytes);
  const tokenHash = await hashAuthValue(token);
  const expiresAt = new Date(now.getTime() + ACCESS_COOKIE_MAX_AGE_SECONDS * 1000);
  const { error } = await client.from("app_sessions").insert({
    token_hash: tokenHash,
    credential_version: readCredentialVersion(),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw error;
  return token;
}

export async function isValidAccessToken(client: AuthClient, token: string | undefined, now = new Date()): Promise<boolean> {
  if (!token || token.length < 32 || token.length > 128) return false;
  try {
    const tokenHash = await hashAuthValue(token);
    const { data, error } = await client.from("app_sessions")
      .select("expires_at,revoked_at,credential_version")
      .eq("token_hash", tokenHash).maybeSingle();
    if (error) return false;
    return Boolean(data && !data.revoked_at && Date.parse(data.expires_at) > now.getTime()
      && data.credential_version === readCredentialVersion());
  } catch {
    return false; // Rejected storage/network operations also fail closed.
  }
}

export async function revokeAccessSession(client: AuthClient, token: string | undefined, now = new Date()): Promise<void> {
  if (!token) return;
  const { error } = await client.from("app_sessions").update({ revoked_at: now.toISOString() })
    .eq("token_hash", await hashAuthValue(token));
  if (error) throw error;
}

export async function recordLoginAttempt(client: AuthClient, clientKey: string, succeeded: boolean): Promise<boolean> {
  const clientKeyHash = await hashAuthValue(`${readAccessPassword()}\0${clientKey}`);
  const { data, error } = await client.rpc("record_app_login_attempt", {
    p_client_key_hash: clientKeyHash,
    p_succeeded: succeeded,
    p_limit: LOGIN_ATTEMPT_LIMIT,
    p_window_seconds: LOGIN_ATTEMPT_WINDOW_SECONDS,
  });
  if (error) throw error;
  return data === true;
}
