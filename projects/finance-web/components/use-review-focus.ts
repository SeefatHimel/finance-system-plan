"use client";

import { useEffect, useRef, type RefObject } from "react";
import { lockBodyScroll } from "@/lib/body-scroll-lock";
import { useToast } from "@/components/toast-provider";

/** Expand the existing form without reparenting, cloning or remounting it. */
export function useReviewFocus(enabled: boolean, surface: RefObject<HTMLElement>, queue: RefObject<HTMLElement>, exit: () => void) {
  const entry = useRef<{ trigger: HTMLElement | null; scroll: { x: number; y: number; queue: number } } | null>(null);
  const exitRef = useRef(exit);
  exitRef.current = exit;
  const { registerModal } = useToast();
  useEffect(() => {
    const element = surface.current;
    if (!enabled || !element) return;
    const queueElement = queue.current;
    const snapshot = entry.current ?? {
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      scroll: { x: window.scrollX, y: window.scrollY, queue: queueElement?.scrollTop ?? 0 }
    };
    entry.current = null;
    const { trigger, scroll } = snapshot;
    const background: Array<{ element: HTMLElement; inert: boolean }> = [];
    // Disable background controls without altering their React state or scroll position.
    for (let branch: HTMLElement | null = element; branch?.parentElement && branch !== document.body; branch = branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === branch || sibling.matches("dialog, .action-toast, .help-tooltip, script, style")) continue;
        background.push({ element: sibling, inert: sibling.inert });
        sibling.inert = true;
      }
    }
    const releaseScroll = lockBodyScroll();
    const unregister = registerModal(element);
    document.body.dataset.reviewFocus = "true";
    const viewport = window.visualViewport;
    const resize = () => {
      // Preserve browser pinch zoom; only adapt to keyboard/normal viewport changes.
      if (viewport && viewport.scale !== 1) return;
      element.style.setProperty("--review-focus-height", `${viewport?.height ?? window.innerHeight}px`);
      element.style.setProperty("--review-focus-top", `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault(); exitRef.current(); return;
      }
      if (event.key !== "Tab") return;
      const targets = Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]'))
        .filter(target => target.getClientRects().length > 0 && getComputedStyle(target).visibility !== "hidden");
      const first = targets[0], last = targets[targets.length - 1];
      if (!first) return;
      if (!element.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    element.querySelector<HTMLElement>(".review-focus-title")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", keyboard);
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      unregister(); releaseScroll();
      delete document.body.dataset.reviewFocus;
      element.style.removeProperty("--review-focus-height");
      element.style.removeProperty("--review-focus-top");
      for (const item of background) item.element.inert = item.inert;
      // Restore the queue/outer-page position after the normal layout returns.
      window.requestAnimationFrame(() => {
        if (!element.isConnected || document.body.dataset.reviewFocus === "true") return;
        if (queueElement?.isConnected) queueElement.scrollTop = scroll.queue;
        if (trigger?.isConnected && !document.querySelector("dialog[open]")) trigger.focus({ preventScroll: true });
        window.scrollTo(scroll.x, scroll.y);
      });
    };
  }, [enabled, queue, registerModal, surface]);
  return (trigger?: HTMLElement) => {
    // Capture before fixed positioning can shrink a mobile page and clamp its scroll.
    entry.current = {
      trigger: trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
      scroll: { x: window.scrollX, y: window.scrollY, queue: queue.current?.scrollTop ?? 0 }
    };
  };
}
