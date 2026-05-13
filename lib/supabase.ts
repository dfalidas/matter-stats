import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getRequiredPublicSupabaseEnv, isPublicSupabaseConfigured } from "@/lib/public-env";
import type { Database } from "@/lib/supabase-types";

export type BrowserSupabaseClient = SupabaseClient<Database>;

let browserSupabaseClient: BrowserSupabaseClient | null = null;

export const isSupabaseConfigured = isPublicSupabaseConfigured;

export function createBrowserSupabaseClient(): BrowserSupabaseClient {
  const { supabaseUrl, supabaseAnonKey } = getRequiredPublicSupabaseEnv();

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function getBrowserSupabaseClient(): BrowserSupabaseClient | null {
  if (!isSupabaseConfigured) {
    return null;
  }

  browserSupabaseClient ??= createBrowserSupabaseClient();
  return browserSupabaseClient;
}

export const supabase = getBrowserSupabaseClient();
