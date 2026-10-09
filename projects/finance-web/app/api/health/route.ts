import { NextResponse } from "next/server";
import { getServerApiBaseUrl } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Public health proxy: no financial data, auth refresh or client-supplied URL. */
export async function GET() {
  const headers = { "Cache-Control": "no-store, max-age=0" };
  try {
    const response = await fetch(`${getServerApiBaseUrl()}/api/health/`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    return NextResponse.json({ status: response.ok ? "ok" : "unavailable" }, { status: response.ok ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
}
