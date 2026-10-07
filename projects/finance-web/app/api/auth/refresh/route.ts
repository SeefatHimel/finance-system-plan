import { NextResponse } from "next/server";
import { isAuthenticationFailure } from "@/lib/auth-errors";

import {
  clearAuthCookies,
  isSameOriginRequest,
  refreshCookieBackedSession,
  setAuthCookies
} from "@/lib/server-auth";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  try {
    const session = await refreshCookieBackedSession();
    const response = NextResponse.json({
      user: session.user
    });
    setAuthCookies(response, session.rotatedTokens);
    return response;
  } catch (error) {
    const response = NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not refresh session."
      },
      {
        status: isAuthenticationFailure(error) ? 401 : 502
      }
    );
    if (isAuthenticationFailure(error)) clearAuthCookies(response);
    return response;
  }
}
