const PUBLIC_SUPABASE_ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

type PublicSupabaseEnvKey = (typeof PUBLIC_SUPABASE_ENV_KEYS)[number];

type RequiredPublicSupabaseEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

function readOptionalPublicEnv(key: PublicSupabaseEnvKey): string | undefined {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value : undefined;
}

export const publicSupabaseEnv = Object.freeze({
  supabaseUrl: readOptionalPublicEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: readOptionalPublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
});

export const isPublicSupabaseConfigured = Boolean(publicSupabaseEnv.supabaseUrl && publicSupabaseEnv.supabaseAnonKey);

export function getRequiredPublicSupabaseEnv(): RequiredPublicSupabaseEnv {
  const missingKeys = PUBLIC_SUPABASE_ENV_KEYS.filter((key) => !readOptionalPublicEnv(key));

  if (missingKeys.length > 0) {
    throw new Error(
      [
        `Missing public Supabase environment variable${missingKeys.length === 1 ? "" : "s"}: ${missingKeys.join(", ")}.`,
        "These are browser-safe Supabase client values and must use the NEXT_PUBLIC_ prefix.",
      ].join(" ")
    );
  }

  return {
    supabaseUrl: publicSupabaseEnv.supabaseUrl as string,
    supabaseAnonKey: publicSupabaseEnv.supabaseAnonKey as string,
  };
}
