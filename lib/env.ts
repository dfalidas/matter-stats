import "server-only";

const REQUIRED_SERVER_ENV_KEYS = [
  "APP_ACCESS_PASSWORD",
  "MATTER_API_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

type RequiredServerEnvKey = (typeof REQUIRED_SERVER_ENV_KEYS)[number];

function readRequiredServerEnv(key: RequiredServerEnvKey): string {
  const value = process.env[key];

  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required server environment variable: ${key}. Add ${key} to your deployment environment or local .env file.`
    );
  }

  return value;
}

function validateServerEnv() {
  const missingKeys = REQUIRED_SERVER_ENV_KEYS.filter((key) => {
    const value = process.env[key];
    return !value || value.trim().length === 0;
  });

  if (missingKeys.length > 0) {
    throw new Error(
      [
        `Missing required server environment variable${missingKeys.length === 1 ? "" : "s"}: ${missingKeys.join(", ")}.`,
        "These values are server-only and must not be prefixed with NEXT_PUBLIC_ or imported into client components.",
        "Add them to your deployment environment or local .env file before using server-side Matter or Supabase admin features.",
      ].join(" ")
    );
  }
}

validateServerEnv();

export const serverEnv = Object.freeze({
  appAccessPassword: readRequiredServerEnv("APP_ACCESS_PASSWORD"),
  matterApiToken: readRequiredServerEnv("MATTER_API_TOKEN"),
  supabase: Object.freeze({
    url: readRequiredServerEnv("SUPABASE_URL"),
    serviceRoleKey: readRequiredServerEnv("SUPABASE_SERVICE_ROLE_KEY"),
  }),
});

export const env = serverEnv;

export type ServerEnv = typeof serverEnv;
