import { NextResponse, type NextRequest } from "next/server";
import { accessCookieName, isProtectedPath, loginHref, refreshCookieName } from "@/lib/auth-navigation";

export function middleware(request: NextRequest) {
  const protectedPage = isProtectedPath(request.nextUrl.pathname);
  // Cookie presence is only an early routing check. The API verifies the session.
  const response = process.env.NODE_ENV === "production" && protectedPage
    && !request.cookies.get(accessCookieName)?.value && !request.cookies.get(refreshCookieName)?.value
    ? NextResponse.redirect(new URL(loginHref(request.nextUrl.pathname + request.nextUrl.search), request.url))
    : NextResponse.next();
  if (protectedPage) response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export const config = { matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"] };
