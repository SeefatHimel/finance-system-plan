"use client";

import { DotsThree } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Portal keeps row actions out of the table's horizontal clipping boundary. */
export function TransactionActionMenu({ label, children, icon }: { label: string; children: ReactNode; icon?: ReactNode }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const positionMenu = useCallback(() => {
    if (!trigger.current || !popup.current) return;
    const button = trigger.current.getBoundingClientRect();
    const menu = popup.current.getBoundingClientRect();
    if (button.bottom < 0 || button.top > window.innerHeight || button.right < 0 || button.left > window.innerWidth) {
      setOpen(false);
      return;
    }
    setPosition({
      left: Math.max(8, Math.min(button.right - menu.width, window.innerWidth - menu.width - 8)),
      top: button.bottom + menu.height + 8 <= window.innerHeight ? button.bottom + 6 : Math.max(8, button.top - menu.height - 6),
    });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
    popup.current?.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true });
  }, [open, positionMenu]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false);
    };
    // Focus and horizontal table scrolling can finish after the trigger click.
    // Keep the menu attached to its trigger instead of immediately dismissing it.
    const scroll = (event: Event) => { if (event.target instanceof Node && popup.current?.contains(event.target)) return; positionMenu(); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", scroll); };
  }, [open, positionMenu]);
  return <>
    <button ref={trigger} className="button button--ghost transaction-actions-trigger" type="button" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(value => !value)}>{icon ?? <DotsThree size={22} weight="bold" aria-hidden="true" />}</button>
    {open ? createPortal(<div ref={popup} className="transaction-actions-menu" role="group" aria-label={label} style={position}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onClick={event => { if ((event.target as HTMLElement).closest("button, a")) close(); }}>
      {children}
    </div>, document.body) : null}
  </>;
}
