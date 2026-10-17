"use client";

import { useEffect, useRef, useState } from "react";

/** Document secrets are deliberately separate from saved site-login credentials. */
export function DocumentPasswordField({ id, value, onChange, disabled = false }: {
  id: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  return <div className="field">
    <button className="button button--ghost" type="button" disabled={disabled}
      aria-expanded={open} aria-controls={open ? `${id}-control` : undefined} onClick={() => {
        setOpen(!open);
        if (open) onChange("");
      }}>{open ? "Hide PDF password" : "PDF password (if needed)"}</button>
    {open ? <label htmlFor={id} id={`${id}-control`} className="field">
      <span className="field__label">PDF password</span>
      <input ref={input} id={id} name={id} className="field__control" type="password"
        autoComplete="new-password" data-1p-ignore="true" data-lpignore="true"
        maxLength={256} disabled={disabled} value={value}
        onChange={event => onChange(event.target.value)} />
      <span className="field__hint">Only unlocks this PDF. Never saved.</span>
    </label> : null}
  </div>;
}
