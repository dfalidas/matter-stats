"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACCESS_COOKIE_MAX_AGE_SECONDS, ACCESS_COOKIE_NAME, createAccessToken, isCorrectAccessPassword } from "@/lib/auth-cookie";

export type LoginState = {
  error?: string;
};

export async function login(_previousState: LoginState, formData: FormData): Promise<LoginState> {
  const submittedPassword = formData.get("password");

  if (typeof submittedPassword !== "string" || !isCorrectAccessPassword(submittedPassword)) {
    return { error: "Invalid password. Please try again." };
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: ACCESS_COOKIE_NAME,
    value: await createAccessToken(),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });

  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set({
    name: ACCESS_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  redirect("/login");
}
