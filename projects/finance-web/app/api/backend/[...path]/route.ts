import { type NextRequest, NextResponse } from "next/server";
import { isAuthenticationFailure } from "@/lib/auth-errors";

import {
  clearAuthCookies,
  getCookieBackedAccessToken,
  getServerApiBaseUrl,
  isSameOriginRequest,
  refreshCookieBackedAccessToken,
  setAuthCookies
} from "@/lib/server-auth";

type RouteContext = {
  params: {
    path: string[];
  };
};

const forwardedResponseHeaders = ["content-type", "content-disposition", "cache-control"];

async function proxyBackendRequest(request: NextRequest, context: RouteContext) {
  if (!["GET", "HEAD"].includes(request.method) && !isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  try {
    const session = await getCookieBackedAccessToken();
    const isStatementUpload = ["api/statements/preview", "api/statements/imports"].includes(context.params.path.join("/")) && request.method === "POST";
    const requestBody = request.method === "GET" || request.method === "HEAD" ? undefined
      : isStatementUpload ? await readStatementBody(request) : await request.arrayBuffer();
    const response = await fetchBackend(request, context.params.path, session.accessToken, requestBody);

    if (response.status === 401) {
      const refreshedSession = await refreshCookieBackedAccessToken();
      const retryResponse = await fetchBackend(request, context.params.path, refreshedSession.accessToken, requestBody);
      return buildProxyResponse(retryResponse, refreshedSession.rotatedTokens);
    }

    return buildProxyResponse(response, session.rotatedTokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    const status = error instanceof StatementUploadLimitError ? 413 : isAuthenticationFailure(error) ? 401 : 502;
    const response = NextResponse.json(
      {
        error: message
      },
      {
        status
      }
    );
    if (status === 401) {
      clearAuthCookies(response);
    }
    return response;
  }
}

class StatementUploadLimitError extends Error {
  constructor() { super("Choose a statement PDF no larger than 4 MiB."); }
}

async function readStatementBody(request: NextRequest): Promise<ArrayBuffer> {
  const maxBytes = 4 * 1024 * 1024 + 65536;
  if (Number(request.headers.get("content-length")) > maxBytes) throw new StatementUploadLimitError();
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new StatementUploadLimitError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

async function fetchBackend(
  request: NextRequest,
  pathSegments: string[],
  accessToken: string,
  body: ArrayBuffer | undefined
) {
  const search = request.nextUrl.search;
  // Next.js normalizes the proxy route without a trailing slash. Django's
  // router requires one and cannot redirect POST/PATCH/DELETE requests while
  // preserving their bodies, so restore it before forwarding the request.
  const backendPath = `/${pathSegments.join("/")}/${search}`;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");

  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  if (accept) {
    headers.set("Accept", accept);
  }
  headers.set("Authorization", `Bearer ${accessToken}`);

  return fetch(`${getServerApiBaseUrl()}${backendPath}`, {
    body,
    cache: "no-store",
    headers,
    method: request.method
  });
}

async function buildProxyResponse(response: Response, rotatedTokens: { access: string; refresh: string } | null) {
  const body = await response.arrayBuffer();
  const headers = new Headers();

  forwardedResponseHeaders.forEach((headerName) => {
    const value = response.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  });

  const proxyResponse = new NextResponse(body, {
    headers,
    status: response.status
  });
  if (rotatedTokens) {
    setAuthCookies(proxyResponse, rotatedTokens);
  }
  if (response.status === 401) {
    clearAuthCookies(proxyResponse);
  }
  return proxyResponse;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyBackendRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyBackendRequest(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxyBackendRequest(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyBackendRequest(request, context);
}
