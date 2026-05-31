import { NextResponse } from "next/server";
import { z } from "zod";

import { backendCurrentUser, backendLogin, clearAuthCookies, setAuthCookies } from "@/lib/server-auth";

const loginRequestSchema = z.object({
  password: z.string().min(1),
  username: z.string().min(1)
});

export async function POST(request: Request) {
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
