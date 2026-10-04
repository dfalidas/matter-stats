import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACCESS_COOKIE_NAME, isValidAccessToken } from "@/lib/auth-cookie";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { authorizeAccessSession } from "@/lib/access-control";

/** Mandatory data-layer boundary; middleware is only an early UX redirect. */
export async function requireAccessSession(): Promise<void> {
  if (!await authorizeAccessSession({
    readToken: async () => (await cookies()).get(ACCESS_COOKIE_NAME)?.value,
    validateToken: (token) => isValidAccessToken(getSupabaseAdminClient(), token),
  })) {
    redirect("/login");
  }
}
