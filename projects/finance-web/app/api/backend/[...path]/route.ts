import { type NextRequest, NextResponse } from "next/server";

import {
  clearAuthCookies,
  getCookieBackedAccessToken,
  getServerApiBaseUrl,
  refreshCookieBackedAccessToken,
  setAuthCookies
} from "@/lib/server-auth";

type RouteContext = {
  params: {
    path: string[];
  };
};

const forwardedResponseHeaders = ["content-type", "content-disposition"];

async function proxyBackendRequest(request: NextRequest, context: RouteContext) {
  const requestBody =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  try {
    const session = await getCookieBackedAccessToken();
    const response = await fetchBackend(request, context.params.path, session.accessToken, requestBody);

    if (response.status === 401) {
      const refreshedSession = await refreshCookieBackedAccessToken();
      const retryResponse = await fetchBackend(request, context.params.path, refreshedSession.accessToken, requestBody);
      return buildProxyResponse(retryResponse, refreshedSession.rotatedTokens);
    }

    return buildProxyResponse(response, session.rotatedTokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    const status = message === "Not signed in." || message.includes("expired") ? 401 : 502;
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

async function fetchBackend(
  request: NextRequest,
  pathSegments: string[],
  accessToken: string,
  body: ArrayBuffer | undefined
) {
  const search = request.nextUrl.search;
  const backendPath = `/${pathSegments.join("/")}${search}`;
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
