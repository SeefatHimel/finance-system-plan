"use client";

import { useEffect, useRef, useState } from "react";
import { AccountAvatar } from "@/components/account-avatar";

export function AccountLogoField({ name, accountId, value, onChange, onBusy, onError, disabled }: {
  name: string; accountId?: string; value: string; onChange: (value: string) => void;
  onBusy: (busy: boolean) => void; onError: (message: string) => void; disabled: boolean;
}) {
  const [reading, setReading] = useState(false);
  const reader = useRef<FileReader | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => { reader.current?.abort(); }, []);

  function choose(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { onError("Choose a PNG, JPG or WebP logo."); return; }
    if (file.size > 1024 * 1024) { onError("Choose a logo image no larger than 1 MB."); return; }
    reader.current?.abort();
    const current = new FileReader(); reader.current = current;
    setReading(true); onBusy(true);
    current.onload = () => { if (reader.current === current) onChange(String(current.result)); };
    current.onerror = () => { if (reader.current === current) onError("Could not read this image. Try another logo."); };
    current.onloadend = () => { if (reader.current === current) { setReading(false); onBusy(false); } };
    current.readAsDataURL(file);
  }

  return <div className="account-logo-field field--wide">
    <AccountAvatar account={{ id: accountId, name, logo: value }} size="large" />
    <div><span className="field__label">Account logo <span className="account-logo-optional">Optional</span></span>
      <div className="account-logo-actions">
        <label className={`button button--small account-logo-upload${disabled || reading ? " is-disabled" : ""}`}>
          {reading ? "Reading image…" : value ? "Replace logo" : "Upload logo"}
          <input ref={input} aria-label={value ? "Replace account logo" : "Upload account logo"} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || reading} onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {value ? <button className="button button--ghost button--small" type="button" disabled={disabled || reading} onClick={() => { onChange(""); input.current?.focus(); }}>Remove logo</button> : null}
      </div>
      <p className="field__hint">PNG, JPG or WebP · up to 1 MB. Without a logo, we use the first letter. Saved with the account.</p>
      <span className="sr-only" role="status">{reading ? "Reading account logo" : ""}</span>
    </div>
  </div>;
}
