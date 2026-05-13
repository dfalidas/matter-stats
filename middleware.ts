import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE_NAME, isValidAccessToken } from "@/lib/auth-cookie";

const PUBLIC_FILE = /\.[^/]+$/;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === "/login" ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap") ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  const hasAccess = await isValidAccessToken(request.cookies.get(ACCESS_COOKIE_NAME)?.value);

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
