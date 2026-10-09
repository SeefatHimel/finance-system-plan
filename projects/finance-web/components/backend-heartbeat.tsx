"use client";

import { useEffect } from "react";
import { startBackendHeartbeat } from "@/lib/backend-heartbeat";

const storageKey = "finance.backendHealth.lastSuccess.v1";

export function BackendHeartbeat() {
  useEffect(() => {
    const heartbeat = startBackendHeartbeat({
      online: () => navigator.onLine,
      lastSuccess: () => { try { return Number(localStorage.getItem(storageKey)) || 0; } catch { return 0; } },
      recordSuccess: time => { try { localStorage.setItem(storageKey, String(time)); } catch { /* Storage is optional. */ } },
      ping: async signal => {
        const response = await fetch("/api/health", { cache: "no-store", credentials: "omit", signal });
        if (!response.ok) throw new Error("Backend unavailable");
      }
    });
    const check = () => { void heartbeat.check(); };
    const visible = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", visible);
    return () => {
      heartbeat.stop();
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return null;
}
