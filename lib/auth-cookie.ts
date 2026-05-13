export const ACCESS_COOKIE_NAME = "matter_stats_access";
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const AUTH_TOKEN_MESSAGE = "matter-stats-access-v1";

function readAccessPassword(): string {
  const password = process.env.APP_ACCESS_PASSWORD;

  if (!password || password.trim().length === 0) {
    throw new Error("Missing required server environment variable: APP_ACCESS_PASSWORD.");
  }

  return password;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export function isCorrectAccessPassword(submittedPassword: string): boolean {
  return constantTimeEqual(submittedPassword, readAccessPassword());
}

export async function createAccessToken(): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(readAccessPassword()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(AUTH_TOKEN_MESSAGE));

  return toBase64Url(new Uint8Array(signature));
}

export async function isValidAccessToken(token: string | undefined): Promise<boolean> {
  if (!token) {
    return false;
  }

  const expectedToken = await createAccessToken();
  return constantTimeEqual(token, expectedToken);
}
