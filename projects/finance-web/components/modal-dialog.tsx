"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/toast-provider";
import { lockBodyScroll } from "@/lib/body-scroll-lock";

type Props = { initialFocus?: string; children: ReactNode; labelledBy: string; className?: string; busy?: boolean; onCancel: () => void };

function DialogSurface({ children, labelledBy, className = "decision-modal", busy = false, onCancel, returnFocus, initialFocus }: Props & { returnFocus: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { registerModal } = useToast();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const unregister = registerModal(element);
    const releaseScroll = lockBodyScroll();
    return () => {
      unregister();
      element.close();
      releaseScroll();
      queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      });
    };
  }, [registerModal, returnFocus]);
  useEffect(() => {
    if (initialFocus) dialog.current?.querySelector<HTMLElement>(initialFocus)?.focus({ preventScroll: true });
  }, [initialFocus]);
  return (
    <dialog aria-labelledby={labelledBy} className={`${className} viewport-modal`} ref={dialog}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      {children}
    </dialog>
  );
}

export function ModalDialog(props: Props) {
  const [mounted, setMounted] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // Capture the trigger before React autoFocus moves into the portaled form.
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMounted(true);
  }, []);
  return mounted ? createPortal(<DialogSurface {...props} returnFocus={returnFocus.current} />, document.body) : null;
}
