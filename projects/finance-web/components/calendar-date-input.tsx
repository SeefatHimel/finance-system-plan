"use client";

import { CalendarBlank } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { displayCalendarDate, parseCalendarDate } from "@/lib/calendar-date";

type Props = {
  value?: string | null;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  name?: string;
  id?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
};

export function CalendarDateInput({ value, defaultValue, onChange, name, id, className = "field__control", required, disabled, min, max, ...aria }: Props) {
  const controlled = value !== undefined;
  const [localIso, setLocalIso] = useState(defaultValue ?? "");
  const iso = controlled ? value ?? "" : localIso;
  const [text, setText] = useState(() => displayCalendarDate(iso));
  const [invalid, setInvalid] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const visible = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    if (controlled) return;
    const form = visible.current?.form;
    if (!form) return;
    const reset = () => {
      const next = defaultValue ?? "";
      setLocalIso(next);
      setText(displayCalendarDate(next));
      setInvalid(false);
      visible.current?.setCustomValidity("");
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [controlled, defaultValue]);

  useEffect(() => {
    if (lastEmitted.current === iso) {
      lastEmitted.current = null;
      return;
    }
    setText(displayCalendarDate(iso));
    setInvalid(false);
    visible.current?.setCustomValidity("");
  }, [iso]);

  function commit(next: string) {
    lastEmitted.current = next;
    if (!controlled) setLocalIso(next);
    onChange?.(next);
  }

  function update(nextText: string) {
    const candidate = /^\d{8}$/.test(nextText)
      ? `${nextText.slice(0, 2)}/${nextText.slice(2, 4)}/${nextText.slice(4)}`
      : nextText;
    const parsed = parseCalendarDate(candidate);
    setText(parsed ? displayCalendarDate(parsed) : nextText);
    setInvalid(Boolean(nextText && !parsed));
    visible.current?.setCustomValidity(nextText && !parsed ? "Enter a valid date as dd/mm/yyyy." : "");
    commit(parsed ?? "");
  }

  return <span className="calendar-date-input">
    {name ? <input type="hidden" name={name} value={iso} disabled={disabled} /> : null}
    <input
      ref={visible}
      {...aria}
      id={id}
      name={name}
      className={className}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/yyyy"
      maxLength={10}
      pattern="(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/[0-9]{4}"
      aria-invalid={Boolean(aria["aria-invalid"] || invalid)}
      value={text}
      required={required}
      disabled={disabled}
      onChange={event => update(event.target.value)}
    />
    <button className="calendar-date-input__button" type="button" aria-label="Choose date" disabled={disabled} onClick={() => {
      try {
        if (picker.current?.showPicker) picker.current.showPicker();
        else picker.current?.click();
      } catch { picker.current?.click(); }
    }}><CalendarBlank size={18} aria-hidden="true" /></button>
    <input ref={picker} className="calendar-date-input__native" type="date" tabIndex={-1} aria-hidden="true" value={iso} min={min} max={max} disabled={disabled} onChange={event => {
      const next = event.target.value;
      setText(displayCalendarDate(next));
      setInvalid(false);
      visible.current?.setCustomValidity("");
      commit(next);
    }} />
  </span>;
}
