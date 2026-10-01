"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { type CurrentUser, getCurrentUser, revokeAuthSession } from "@/lib/api";
import {
  canUseLocalTokenStorage,
  clearTokens,
  getAccessToken,
  getRefreshToken
} from "@/lib/auth-storage";
import { getCookieSessionUser, logoutCookieSession } from "@/lib/session-api";

type SessionState =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: CurrentUser }
  | { message: string; status: "error" };

export function SessionPanel() {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>({ status: "checking" });

  useEffect(() => {
    if (!canUseLocalTokenStorage()) {
      getCookieSessionUser()
        .then((user) => setSession({ status: "signed-in", user }))
        .catch((error) => {
          if (error instanceof Error && error.message === "Not signed in.") {
            setSession({ status: "signed-out" });
            return;
          }
          setSession({
            message: error instanceof Error ? error.message : "Session expired.",
            status: "error"
          });
        });
      return;
    }

    const accessToken = getAccessToken();

    if (!accessToken) {
      setSession({ status: "signed-out" });
      return;
    }

    getCurrentUser(accessToken)
      .then((user) => setSession({ status: "signed-in", user }))
      .catch((error) => {
        clearTokens();
        setSession({
          message: error instanceof Error ? error.message : "Session expired.",
          status: "error"
        });
      });
  }, []);

  async function handleSignOut() {
    try {
      if (canUseLocalTokenStorage()) {
        const refreshToken = getRefreshToken();
        try {
          if (refreshToken) {
            await revokeAuthSession(refreshToken);
          }
        } finally {
          clearTokens();
        }
      } else {
        await logoutCookieSession();
      }
    } finally {
      setSession({ status: "signed-out" });
      router.refresh();
    }
  }

  if (session.status === "checking") {
    return (
      <div className="session-card">
        <span className="status-badge status-badge--idle">Checking</span>
      </div>
    );
  }

  if (session.status === "signed-in") {
    const displayName =
      [session.user.first_name, session.user.last_name].filter(Boolean).join(" ") ||
      session.user.username;

    return (
      <div className="session-card">
        <div>
          <span className="session-card__label">Signed in</span>
          <strong className="session-card__name">{displayName}</strong>
        </div>
        <button className="button button--ghost" onClick={() => void handleSignOut()} type="button">
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="session-card">
      <div>
        <span className="session-card__label">
          {session.status === "error" ? session.message : "Not signed in"}
        </span>
        <strong className="session-card__name">Local API access</strong>
      </div>
      <Link className="button button--primary" href="/login">
        Sign in
      </Link>
    </div>
  );
}
