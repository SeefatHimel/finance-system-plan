import { NextResponse } from "next/server";

import {
  clearAuthCookies,
  isSameOriginRequest,
  revokeCookieBackedSession
} from "@/lib/server-auth";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  try {
    await revokeCookieBackedSession();
  } catch {
    // Local credentials must still be removed if the API is temporarily unavailable.
  }
  const response = NextResponse.json({
    ok: true
  });
  clearAuthCookies(response);
  return response;
}
