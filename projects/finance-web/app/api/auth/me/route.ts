import { NextResponse } from "next/server";

import { clearAuthCookies, getCookieBackedCurrentUser, setAuthCookies } from "@/lib/server-auth";

export async function GET() {
  try {
    const session = await getCookieBackedCurrentUser();
    const response = NextResponse.json(session.user);
    if (session.rotatedTokens) {
      setAuthCookies(response, session.rotatedTokens);
    }
    return response;
  } catch (error) {
    const response = NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Session expired."
      },
      {
        status: 401
      }
    );
    clearAuthCookies(response);
    return response;
  }
}
