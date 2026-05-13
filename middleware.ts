import { NextResponse, type NextRequest } from "next/server";
import { APP_SESSION_COOKIE, APP_SESSION_VALUE, PROTECTED_PATHS } from "@/lib/auth/constants";

function isProtectedPath(pathname: string) {
  return PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthenticated = request.cookies.get(APP_SESSION_COOKIE)?.value === APP_SESSION_VALUE;

  if (pathname === "/") {
    return NextResponse.redirect(new URL(isAuthenticated ? "/dashboard" : "/login", request.url));
  }

  if (pathname === "/login" && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isProtectedPath(pathname) && !isAuthenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/dashboard/:path*", "/reports/:path*", "/sources/:path*", "/authors/:path*", "/tags/:path*", "/articles/:path*", "/year-in-reading/:path*", "/settings/:path*", "/api/sync"],
};
