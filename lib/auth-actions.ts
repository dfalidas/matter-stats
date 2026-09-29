"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { headers } from "next/headers";
import { ACCESS_COOKIE_MAX_AGE_SECONDS, ACCESS_COOKIE_NAME, createAccessSession, isCorrectAccessPassword, recordLoginAttempt, revokeAccessSession } from "@/lib/auth-cookie";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export type LoginState = {
  error?: string;
};

export async function login(_previousState: LoginState, formData: FormData): Promise<LoginState> {
  const submittedPassword = formData.get("password");
  const headerStore = await headers();
  const clientKey = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const client = getSupabaseAdminClient();
  const passwordIsCorrect = typeof submittedPassword === "string" && isCorrectAccessPassword(submittedPassword);
  const allowed = await recordLoginAttempt(client, clientKey, passwordIsCorrect);
  if (!allowed) return { error: "Too many attempts. Please wait 15 minutes and try again." };

  if (!passwordIsCorrect) {
    return { error: "Invalid password. Please try again." };
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: ACCESS_COOKIE_NAME,
    value: await createAccessSession(client),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });

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
