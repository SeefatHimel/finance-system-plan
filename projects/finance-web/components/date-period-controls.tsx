"use client";

import { useEffect, useId, useState } from "react";
import { CalendarCheck } from "@phosphor-icons/react";
import { CalendarDateInput } from "@/components/calendar-date-input";
import { allDates, dailyPeriod, dateRangeError, monthPeriod, periodLabel, shiftPeriod, type DatePeriod } from "@/lib/date-period";

export function DatePeriodControls({ value, onChange, allowAll = true, label = "Date filter", description, children, compact = false }: {
  value: DatePeriod; onChange: (value: DatePeriod) => void; allowAll?: boolean;
  label?: string; description?: string; children?: React.ReactNode; compact?: boolean;
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
  function chooseMode(choice: DatePeriod["mode"]) {
    setError("");
    setCustomOpen(choice === "custom");
    if (choice === "all") onChange({ ...allDates });
    if (choice === "daily") onChange(dailyPeriod(value.start || undefined));
    if (choice === "monthly") onChange(monthPeriod(value.start.slice(0, 7) || undefined));
  }
  return <div className={`date-period-controls${compact ? " date-period-controls--compact" : ""}`} role="region" aria-label={label}>
    {children}
    {compact ? <label className="field date-period-mode"><span className="field__label">{label}</span><select className="field__control" aria-label={`${label} view`} value={mode} onChange={event => chooseMode(event.target.value as DatePeriod["mode"])}>
      {allowAll ? <option value="all">All dates</option> : null}<option value="daily">Daily</option><option value="monthly">Monthly</option><option value="custom">Custom range</option>
    </select></label> : <div className="date-period-modes" role="group" aria-label={`${label} view`}>
      {([...(allowAll ? ["all"] as const : []), "daily", "monthly", "custom"] as const).map(choice => <button
        className="button button--ghost" type="button" aria-pressed={mode === choice} key={choice}
        onClick={() => chooseMode(choice)}
      >{{ all: "All dates", daily: "Daily", monthly: "Monthly", custom: "Custom range" }[choice]}</button>)}
    </div>}
    {mode === "custom" ? <div className="date-period-fields" onKeyDown={event => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); applyCustom(); }
    }}>
      <label className="field" htmlFor={`${id}-start`}><span className="field__label">Start date</span><CalendarDateInput id={`${id}-start`} value={custom.start} onChange={start => setCustom(old => ({ ...old, start }))} /></label>
      <label className="field" htmlFor={`${id}-end`}><span className="field__label">End date</span><CalendarDateInput id={`${id}-end`} min={custom.start} value={custom.end} onChange={end => setCustom(old => ({ ...old, end }))} /></label>
      <button className="button button--primary" type="button" onClick={applyCustom}>Apply dates</button>
    </div> : mode !== "all" ? <div className="date-period-fields date-period-fields--single">
      <button className="button button--ghost" type="button" aria-label={`Previous ${mode === "daily" ? "day" : "month"}`} onClick={() => onChange(shiftPeriod(value, -1))}>←</button>
      <label className="field" htmlFor={`${id}-date`}><span className="field__label">{mode === "daily" ? "Day" : "Month (choose any day)"}</span><CalendarDateInput id={`${id}-date`} value={value.start} onChange={date => {
        if (date) onChange(mode === "daily" ? dailyPeriod(date) : monthPeriod(date.slice(0, 7)));
      }} /></label>
      <button className="button button--ghost" type="button" aria-label={`Next ${mode === "daily" ? "day" : "month"}`} onClick={() => onChange(shiftPeriod(value, 1))}>→</button>
      <button className="button button--ghost" type="button" aria-label={mode === "daily" ? "Today" : "Current month"} title={mode === "daily" ? "Today" : "Current month"} onClick={() => onChange(mode === "daily" ? dailyPeriod() : monthPeriod())}>{compact ? <CalendarCheck aria-hidden="true" size={18} /> : mode === "daily" ? "Today" : "Current month"}</button>
    </div> : null}
    <p className="date-period-caption" title={compact ? periodLabel(value) : undefined}>{compact && mode !== "custom" ? description || periodLabel(value) : `${periodLabel(value)}${description ? ` · ${description}` : ""}`}</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}
