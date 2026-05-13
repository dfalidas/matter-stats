import { createClient } from "@supabase/supabase-js";

import { isPublicSupabaseConfigured, publicSupabaseEnv } from "@/lib/public-env";

export const isSupabaseConfigured = isPublicSupabaseConfigured;

export const supabase = isSupabaseConfigured
  ? createClient(publicSupabaseEnv.supabaseUrl as string, publicSupabaseEnv.supabaseAnonKey as string)
  : null;
