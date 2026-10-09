"use client";

import { useEffect, useId, useState } from "react";
import { allDates, dailyPeriod, dateRangeError, monthPeriod, periodLabel, shiftPeriod, type DatePeriod } from "@/lib/date-period";

export function DatePeriodControls({ value, onChange, allowAll = true, label = "Date filter", description, children }: {
  value: DatePeriod; onChange: (value: DatePeriod) => void; allowAll?: boolean;
  label?: string; description?: string; children?: React.ReactNode;
}) {
  const id = useId();
  const [custom, setCustom] = useState({ start: value.start || dailyPeriod().start, end: value.end || dailyPeriod().end });
  const [customOpen, setCustomOpen] = useState(value.mode === "custom");
  const [error, setError] = useState("");
  useEffect(() => {
    setCustomOpen(value.mode === "custom");
    setCustom({ start: value.start || dailyPeriod().start, end: value.end || dailyPeriod().end });
    setError("");
  }, [value.mode, value.start, value.end]);

  function applyCustom() {
    const message = dateRangeError(custom.start, custom.end);
    setError(message);
    if (!message) onChange({ mode: "custom", ...custom });
  }

  const mode = customOpen ? "custom" : value.mode;
  return <div className="date-period-controls" role="region" aria-label={label}>
    {children}
    <div className="date-period-modes" role="group" aria-label={`${label} view`}>
      {([...(allowAll ? ["all"] as const : []), "daily", "monthly", "custom"] as const).map(choice => <button
        className={`button${mode === choice ? " button--primary" : " button--ghost"}`} type="button" aria-pressed={mode === choice} key={choice}
        onClick={() => {
          setError("");
          setCustomOpen(choice === "custom");
          if (choice === "all") onChange({ ...allDates });
          if (choice === "daily") onChange(dailyPeriod(value.start || undefined));
          if (choice === "monthly") onChange(monthPeriod(value.start.slice(0, 7) || undefined));
        }}
      >{{ all: "All dates", daily: "Daily", monthly: "Monthly", custom: "Custom range" }[choice]}</button>)}
    </div>
    {mode === "custom" ? <div className="date-period-fields" onKeyDown={event => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); applyCustom(); }
    }}>
      <label className="field" htmlFor={`${id}-start`}><span className="field__label">Start date</span><input id={`${id}-start`} className="field__control" type="date" value={custom.start} onChange={event => setCustom(old => ({ ...old, start: event.target.value }))} /></label>
      <label className="field" htmlFor={`${id}-end`}><span className="field__label">End date</span><input id={`${id}-end`} className="field__control" type="date" min={custom.start} value={custom.end} onChange={event => setCustom(old => ({ ...old, end: event.target.value }))} /></label>
      <button className="button button--primary" type="button" onClick={applyCustom}>Apply dates</button>
    </div> : mode !== "all" ? <div className="date-period-fields">
      <button className="button button--ghost" type="button" aria-label={`Previous ${mode === "daily" ? "day" : "month"}`} onClick={() => onChange(shiftPeriod(value, -1))}>←</button>
      <label className="field" htmlFor={`${id}-date`}><span className="field__label">{mode === "daily" ? "Day" : "Month"}</span><input id={`${id}-date`} className="field__control" type={mode === "daily" ? "date" : "month"} value={mode === "daily" ? value.start : value.start.slice(0, 7)} onChange={event => {
        if (event.target.value) onChange(mode === "daily" ? dailyPeriod(event.target.value) : monthPeriod(event.target.value));
      }} /></label>
      <button className="button button--ghost" type="button" aria-label={`Next ${mode === "daily" ? "day" : "month"}`} onClick={() => onChange(shiftPeriod(value, 1))}>→</button>
      <button className="button button--ghost" type="button" onClick={() => onChange(mode === "daily" ? dailyPeriod() : monthPeriod())}>{mode === "daily" ? "Today" : "Current month"}</button>
    </div> : null}
    <p className="date-period-caption">{periodLabel(value)}{description ? ` · ${description}` : ""}</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}
