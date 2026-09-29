import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { ACCESS_COOKIE_NAME, isValidAccessToken } from "@/lib/auth-cookie";

const PUBLIC_PATHS = new Set(["/login", "/favicon.ico", "/robots.txt", "/sitemap.xml"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api/cron/") ||
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/_next/") ||
    pathname === "/icon.svg"
  ) {
    return NextResponse.next();
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasAccess = Boolean(url && key) && await isValidAccessToken(
    createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } }),
    request.cookies.get(ACCESS_COOKIE_NAME)?.value,
  );

  if (!hasAccess) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
