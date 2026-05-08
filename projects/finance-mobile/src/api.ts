export type HealthResponse = {
  status: "ok";
};

export type HealthResult = {
  error?: string;
  ok: boolean;
  status?: string;
};

export function getApiBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:8000";
}

export async function checkHealth(): Promise<HealthResult> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/health/`);
    if (!response.ok) {
      return {
        error: `HTTP ${response.status}`,
        ok: false
      };
    }

    const payload = (await response.json()) as HealthResponse;
    return {
      ok: payload.status === "ok",
      status: payload.status
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown network error",
      ok: false
    };
  }
}
