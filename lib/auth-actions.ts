"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { headers } from "next/headers";
import { ACCESS_COOKIE_NAME, accessCookieOptions, createAccessSession, isCorrectAccessPassword, recordLoginAttempt, revokeAccessSession } from "@/lib/auth-cookie";
import { runLoginFlow } from "@/lib/auth-flow";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export type LoginState = {
  error?: string;
};

export async function login(_previousState: LoginState, formData: FormData): Promise<LoginState> {
  const submittedPassword = formData.get("password");
  const headerStore = await headers();
  const clientKey = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const result = await runLoginFlow({
    passwordIsCorrect: () => typeof submittedPassword === "string" && isCorrectAccessPassword(submittedPassword),
    recordAttempt: (succeeded) => recordLoginAttempt(getSupabaseAdminClient(), clientKey, succeeded),
    createSession: () => createAccessSession(getSupabaseAdminClient()),
    issueCookie: async (token) => { (await cookies()).set(accessCookieOptions(token)); },
    diagnose: (reason) => console.error("auth_operation_failed", { operation: "login", reason }),
  });
  if (result) return result;

  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  await revokeAccessSession(getSupabaseAdminClient(), cookieStore.get(ACCESS_COOKIE_NAME)?.value);
  cookieStore.set({
    name: ACCESS_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  redirect("/login");
}
