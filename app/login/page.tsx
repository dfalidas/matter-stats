import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCESS_COOKIE_NAME, isValidAccessToken } from "@/lib/auth-cookie";

import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const hasAccess = await isValidAccessToken(cookieStore.get(ACCESS_COOKIE_NAME)?.value);

  if (hasAccess) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex min-h-[55vh] w-full max-w-md items-center">
      <Card className="w-full border-white/10 bg-background/60 shadow-soft">
        <CardHeader>
          <CardTitle>Private access</CardTitle>
          <CardDescription>Enter the shared app password to view your Matter reading dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
