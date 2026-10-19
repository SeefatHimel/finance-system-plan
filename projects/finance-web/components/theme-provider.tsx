"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";

const storageKey = "finance.theme.v1";
const ThemeContext = createContext<{
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
} | null>(null);

function storedPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    setPreference(storedPreference());
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setPreference(storedPreference());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = preference === "system" ? (media.matches ? "dark" : "light") : preference;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  const value = useMemo(() => ({
    preference,
    setPreference: (next: ThemePreference) => {
      setPreference(next);
      try { window.localStorage.setItem(storageKey, next); } catch { /* The theme still works for this tab. */ }
    }
  }), [preference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeProvider is required.");
  return context;
}
