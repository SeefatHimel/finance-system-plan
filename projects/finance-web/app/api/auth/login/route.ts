import { NextResponse } from "next/server";
import { z } from "zod";

import {
  backendCurrentUser,
  backendLogin,
  clearAuthCookies,
  isSameOriginRequest,
  setAuthCookies
} from "@/lib/server-auth";

const loginRequestSchema = z.object({
  password: z.string().min(1),
  username: z.string().min(1)
});

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  try {
    const credentials = loginRequestSchema.parse(await request.json());
    const tokens = await backendLogin(credentials.username, credentials.password);
    const response = NextResponse.json({
      user: await backendCurrentUser(tokens.access)
    });
    setAuthCookies(response, tokens);
    return response;
  } catch (error) {
    const response = NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Login failed."
      },
      {
        status: 401
      }
    );
    clearAuthCookies(response);
    return response;
  }
}
