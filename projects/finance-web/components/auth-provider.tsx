"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getLocalSessionUser, login, revokeAuthSession, type CurrentUser } from "@/lib/api";
import { isAuthenticationFailure } from "@/lib/auth-errors";
import { canUseLocalTokenStorage, clearTokens, getRefreshToken, saveTokens } from "@/lib/auth-storage";
import { loginHref, safeReturnPath, sessionChannelName, sessionExpiredEvent, type LoginReason } from "@/lib/auth-navigation";
import { getCookieSessionUser, loginWithCookieSession, logoutCookieSession } from "@/lib/session-api";
import { LoadingState } from "@/components/loading-state";
import { useToast } from "@/components/toast-provider";

type SessionState = { status: "checking" | "signed-out" }
  | { status: "signed-in"; user: CurrentUser }
  | { status: "error"; message: string };
type AuthContextValue = {
  session: SessionState;
  isSigningOut: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is required.");
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { dismiss, notify } = useToast();
  const [session, setSession] = useState<SessionState>({ status: "checking" });
  const [reason, setReason] = useState<LoginReason>("required");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const version = useRef(0);
  const signingOut = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const checkInFlight = useRef<{ version: number; promise: Promise<void> } | null>(null);
  const invalidateChecks = useCallback(() => { version.current++; }, []);

  const endSession = useCallback((nextReason: LoginReason, broadcast = true) => {
    version.current++;
    clearTokens();
    dismiss();
    setReason(nextReason);
    setSession({ status: "signed-out" });
    if (broadcast) channel.current?.postMessage({ reason: nextReason });
  }, [dismiss]);

  const checkSession = useCallback(() => {
    if (signingOut.current) return Promise.resolve();
    const currentVersion = version.current;
    if (checkInFlight.current?.version === currentVersion) return checkInFlight.current.promise;
    const promise = (async () => {
      try {
        const user = canUseLocalTokenStorage() ? await getLocalSessionUser() : await getCookieSessionUser();
        if (currentVersion !== version.current) return;
        setSession(user ? { status: "signed-in", user } : { status: "signed-out" });
      } catch (error) {
        if (currentVersion !== version.current) return;
        if (isAuthenticationFailure(error)) {
          endSession("expired");
        } else {
          // A temporary outage does not invalidate an already verified session.
          setSession((current) => current.status === "signed-in" ? current : {
            status: "error", message: "We couldn’t verify your session. Check your connection and try again."
          });
        }
      }
    })();
    checkInFlight.current = { version: currentVersion, promise };
    void promise.finally(() => {
      if (checkInFlight.current?.promise === promise) checkInFlight.current = null;
    });
    return promise;
  }, [endSession]);

  useEffect(() => {
    try {
      channel.current = new BroadcastChannel(sessionChannelName);
      channel.current.onmessage = (event) => {
        if (event.data?.reason === "signed-out" || event.data?.reason === "expired") endSession(event.data.reason, false);
      };
    } catch {
      // Storage events and focus revalidation remain available in older browsers.
    }
    const expired = () => { if (!signingOut.current) endSession("expired"); };
    const storageChanged = (event: StorageEvent) => {
      if (!canUseLocalTokenStorage() || (event.key !== "finance.accessToken" && event.key !== null)) return;
      if (!event.newValue) endSession("signed-out", false);
      else { version.current++; void checkSession(); }
    };
    const recheck = () => { void checkSession(); };
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      invalidateChecks();
      setSession({ status: "checking" });
      void checkSession();
    };
    window.addEventListener(sessionExpiredEvent, expired);
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", recheck);
    window.addEventListener("online", recheck);
    window.addEventListener("pageshow", restored);
    void checkSession();
    return () => {
      invalidateChecks();
      channel.current?.close();
      channel.current = null;
      window.removeEventListener(sessionExpiredEvent, expired);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
      window.removeEventListener("pageshow", restored);
    };
  }, [checkSession, endSession, invalidateChecks]);

  useEffect(() => {
    if (session.status === "signed-out" && pathname !== "/login") {
      router.replace(loginHref(window.location.pathname + window.location.search + window.location.hash, reason));
    } else if (session.status === "signed-in" && pathname === "/login") {
      router.replace(safeReturnPath(new URLSearchParams(window.location.search).get("next")));
    }
  }, [pathname, reason, router, session.status]);

  const signIn = useCallback(async (username: string, password: string) => {
    version.current++;
    if (canUseLocalTokenStorage()) saveTokens(await login(username, password));
    else await loginWithCookieSession(username, password);
    // Start a fresh page so data and router caches cannot carry between users.
    window.location.replace(safeReturnPath(new URLSearchParams(window.location.search).get("next")));
  }, []);

  const signOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    version.current++;
    dismiss();
    setIsSigningOut(true);
    const destination = window.location.pathname + window.location.search + window.location.hash;
    try {
      if (canUseLocalTokenStorage()) {
        const refreshToken = getRefreshToken();
        try { if (refreshToken) await revokeAuthSession(refreshToken); }
        catch { /* Local credentials are removed even when the backend is offline. */ }
      } else {
        await logoutCookieSession();
      }
      endSession("signed-out");
      window.location.replace(loginHref(destination, "signed-out"));
    } catch {
      notify("Could not finish signing out. Please try again.", "error");
    } finally {
      signingOut.current = false;
      setIsSigningOut(false);
    }
  }, [dismiss, endSession, notify]);

  const value = useMemo(() => ({ session, isSigningOut, signIn, signOut }), [session, isSigningOut, signIn, signOut]);
  const showPage = !isSigningOut && ((pathname === "/login" && session.status === "signed-out")
    || (pathname !== "/login" && session.status === "signed-in"));
  return (
    <AuthContext.Provider key={session.status === "signed-in" ? session.user.id : "guest"} value={value}>
      {showPage ? children : session.status === "error" && !isSigningOut ? (
        <main className="auth-page"><section className="auth-panel">
          <h1 className="section-title">Connection unavailable</h1>
          <p role="alert" className="section-subtitle">{session.message}</p>
          <button className="button button--primary" onClick={() => {
            setSession({ status: "checking" }); void checkSession();
          }} type="button">Try again</button>
        </section></main>
      ) : (
        <main className="auth-page"><LoadingState compact label={isSigningOut ? "Signing out" : "Checking your session"}
          detail="Please wait a moment" /></main>
      )}
    </AuthContext.Provider>
  );
}
