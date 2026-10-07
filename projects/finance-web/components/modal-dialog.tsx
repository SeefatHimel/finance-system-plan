"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/toast-provider";

type Props = { children: ReactNode; labelledBy: string; className?: string; busy?: boolean; onCancel: () => void };
let openDialogs = 0;
let previousOverflow = "";

function DialogSurface({ children, labelledBy, className = "decision-modal", busy = false, onCancel, returnFocus }: Props & { returnFocus: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { registerModal } = useToast();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const unregister = registerModal(element);
    if (openDialogs++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      unregister();
      element.close();
      if (--openDialogs === 0) document.body.style.overflow = previousOverflow;
      queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      });
    };
  }, [registerModal, returnFocus]);
  return (
    <dialog aria-labelledby={labelledBy} className={`${className} viewport-modal`} ref={dialog}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
      onClick={(event) => {
        if (busy || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onCancel();
      }}>
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
