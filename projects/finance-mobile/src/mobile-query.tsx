import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";

/** In-memory only; the keyed provider is destroyed on logout/user/backend change. */
export function MobileQueryProvider({ children, revision = 0 }: { children: ReactNode; revision?: number }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: {
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
  } } }));
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    // Invalidate while a retained screen is hidden, without rerendering its form.
    void client.invalidateQueries({ queryKey: ["activity"] });
  }, [client, revision]);
  useEffect(() => {
    focusManager.setFocused(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", state => focusManager.setFocused(state === "active"));
    return () => {
      subscription.remove();
      // Let cancelled requests settle before clearing, so their completion
      // cannot schedule collection work against a disposed session cache.
      void client.cancelQueries().finally(() => client.clear());
    };
  }, [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
