"use client";

import { useCallback, useRef } from "react";
import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { rememberConfirmedMessageChoice } from "@/lib/api";

/** Offer optional learning without interrupting the next review decision. */
export function useMessageChoiceToast() {
  const { notify } = useToast();
  const inFlight = useRef(new Set<string>());

  const save = useCallback(async (candidateId: string, replaceExisting = false) => {
    if (inFlight.current.has(candidateId)) return;
    const token = getAccessToken();
    if (!token) { notify("Sign in again before saving a rule.", "error"); return; }
    inFlight.current.add(candidateId);
    notify(replaceExisting ? "Replacing saved SMS rule…" : "Saving optional SMS rule…", "success", { durationMs: 30000 });
    try {
      await rememberConfirmedMessageChoice(token, candidateId, replaceExisting);
      notify("Saved for similar SMS. Future suggestions still need your review.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not save this rule.";
      const status = reason instanceof Error && "status" in reason ? reason.status : null;
      if (status === 409 && message.includes("already saved")) {
        notify(message, "error", { actions: [{ label: "Replace saved rule", onClick: () => void save(candidateId, true) }] });
      } else if (typeof status === "number" && status >= 500) {
        notify("Transaction saved, but the rule was not. You can retry without recording another transaction.", "error", {
          actions: [{ label: "Retry saving rule", onClick: () => void save(candidateId) }],
        });
      } else notify(message, "error");
    } finally { inFlight.current.delete(candidateId); }
  }, [notify]);

  const actionFor = useCallback((candidateId: string) => ({
    label: "Save for similar SMS", onClick: () => void save(candidateId),
  }), [save]);

  const offer = useCallback((candidateId: string | null, message: string) => {
    notify(message, "success", {
      actions: candidateId ? [actionFor(candidateId)] : [],
      durationMs: 15000,
    });
  }, [actionFor, notify]);

  return { actionFor, offer };
}
