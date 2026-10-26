import { createContext, createElement, useContext, type ReactNode } from "react";

const MobileThemeContext = createContext(false);

export function MobileThemeProvider({ isLight, children }: { isLight: boolean; children: ReactNode }) {
  return createElement(MobileThemeContext.Provider, { value: isLight }, children);
}

export function useLightAppearance() {
  return useContext(MobileThemeContext);
}
