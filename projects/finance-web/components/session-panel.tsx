"use client";

import { useAuth } from "@/components/auth-provider";
import { ButtonBusy } from "@/components/loading-state";

export function SessionPanel() {
  const { session, signOut, isSigningOut } = useAuth();
  if (session.status !== "signed-in") return null;
  const displayName = [session.user.first_name, session.user.last_name].filter(Boolean).join(" ") || session.user.username;
  return (
    <div className="session-card">
      <div><span className="session-card__label">Signed in</span><strong className="session-card__name">{displayName}</strong></div>
      <button className="button button--ghost" disabled={isSigningOut} onClick={() => void signOut()} type="button">
        {isSigningOut ? <ButtonBusy label="Signing out" /> : "Sign out"}
      </button>
    </div>
  );
}
