"use client";

import { Info, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Hover/focus help on desktop; tap to toggle on touch devices. */
export function HelpTooltip({ label, children, warning = false }: { label: string; children: ReactNode; warning?: boolean }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const cancelClose = () => clearTimeout(closeTimer.current);
  const close = () => { cancelClose(); pinned.current = false; setOpen(false); };
  const leave = () => {
    cancelClose();
    if (!pinned.current && !trigger.current?.matches(":focus-visible")) closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = trigger.current?.getBoundingClientRect();
      const tip = content.current?.getBoundingClientRect();
      if (!button || !tip) return;
      const left = Math.max(12, Math.min(button.left + button.width / 2 - tip.width / 2, window.innerWidth - tip.width - 12));
      const top = button.top - tip.height - 8 >= 12 ? button.top - tip.height - 8 : Math.min(window.innerHeight - tip.height - 12, button.bottom + 8);
      setPosition({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !content.current?.contains(event.target)) {
        clearTimeout(closeTimer.current); pinned.current = false; setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); clearTimeout(closeTimer.current); pinned.current = false; setOpen(false); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const Icon = warning ? WarningCircle : Info;
  return <>
    <button ref={trigger} type="button" className={`help-trigger${warning ? " help-trigger--warning" : ""}`} aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
      onPointerEnter={event => { if (event.pointerType === "mouse") { cancelClose(); setOpen(true); } }} onPointerLeave={leave}
      onFocus={() => { cancelClose(); setOpen(true); }} onBlur={close}
      onClick={event => { event.preventDefault(); event.stopPropagation(); cancelClose(); pinned.current = !pinned.current; setOpen(pinned.current); }}>
      <Icon size={18} aria-hidden="true" weight={warning ? "fill" : "regular"} />
    </button>
    {open ? createPortal(<div ref={content} id={id} role="tooltip" className="help-tooltip" style={position} onPointerEnter={cancelClose} onPointerLeave={leave}>{children}</div>, trigger.current?.closest("dialog") ?? document.body) : null}
  </>;
}
