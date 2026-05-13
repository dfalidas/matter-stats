"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { APP_SESSION_COOKIE, APP_SESSION_VALUE } from "@/lib/auth/constants";

export type LoginState = {
  error?: string;
};

export async function login(_: LoginState, formData: FormData): Promise<LoginState> {
  const configuredPassword = process.env.APP_ACCESS_PASSWORD;
  const submittedPassword = formData.get("password");

  if (!configuredPassword) {
    return { error: "APP_ACCESS_PASSWORD is not configured on the server." };
  }

  if (typeof submittedPassword !== "string" || submittedPassword !== configuredPassword) {
    return { error: "The app password is incorrect." };
  }

  const cookieStore = await cookies();
  cookieStore.set(APP_SESSION_COOKIE, APP_SESSION_VALUE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect("/dashboard");
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(APP_SESSION_COOKIE);
  redirect("/login");
}
