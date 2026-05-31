import { NextResponse } from "next/server";

import { clearAuthCookies, refreshCookieBackedSession, setAuthCookies } from "@/lib/server-auth";

export async function POST() {
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
        status: 401
      }
    );
    clearAuthCookies(response);
    return response;
  }
}
