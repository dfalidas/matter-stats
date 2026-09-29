import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACCESS_COOKIE_NAME, isValidAccessToken } from "@/lib/auth-cookie";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

/** Mandatory data-layer boundary; middleware is only an early UX redirect. */
export async function requireAccessSession(): Promise<void> {
  const cookieStore = await cookies();
  if (!await isValidAccessToken(getSupabaseAdminClient(), cookieStore.get(ACCESS_COOKIE_NAME)?.value)) {
    redirect("/login");
  }
}
