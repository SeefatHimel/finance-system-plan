"use client";
import { useState } from "react";
import { clockTimeValue } from "@/lib/clock-time";
import { ModalDialog } from "./modal-dialog";

export function QuickTimePicker({
  value,
  onApply,
  onCancel,
  seconds = value.length > 5,
  onClear,
}: {
  value: string;
  onApply: (value: string) => void;
  onCancel: () => void;
  seconds?: boolean;
  onClear?: () => void;
}) {
  const [hour, setHour] = useState(value.slice(0, 2) || "12");
  const [minute, setMinute] = useState(value.slice(3, 5) || "00");
  const [second, setSecond] = useState(value.slice(6, 8) || "00");
  const [view, setView] = useState<"hours" | "minutes">("hours");
  const h = Number(hour),
    m = Number(minute);
  const selectedTime = clockTimeValue(hour, minute, seconds ? second : undefined);
  function select(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const angle =
      ((Math.atan2(
        event.clientX - rect.left - rect.width / 2,
        -(event.clientY - rect.top - rect.height / 2),
      ) *
        180) /
        Math.PI +
        360) %
      360;
    if (view === "hours")
      setHour(
        String((Math.round(angle / 30) % 12) + (h >= 12 ? 12 : 0)).padStart(
          2,
          "0",
        ),
      );
    else setMinute(String(Math.round(angle / 6) % 60).padStart(2, "0"));
  }
  return (
    <ModalDialog
      labelledBy="quick-time-title"
      className="decision-modal quick-time-dialog"
      onCancel={onCancel}
    >
      <h2 id="quick-time-title">Choose time</h2>
      <div className="quick-time-tabs">
        <button
          type="button"
          className="button button--ghost"
          aria-pressed={view === "hours"}
          onClick={() => setView("hours")}
        >
          Hour: {hour}
        </button>
        <button
          type="button"
          className="button button--ghost"
          aria-pressed={view === "minutes"}
          onClick={() => setView("minutes")}
        >
          Minute: {minute}
        </button>
      </div>
      <p>
        Tap or drag to select{" "}
        {view === "hours" ? "the hour, then minutes" : "the minute"}. You can
        also type the exact time below.
      </p>
      <div
        aria-hidden="true"
        className="quick-clock"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          select(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            select(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            select(event);
            event.currentTarget.releasePointerCapture(event.pointerId);
            if (view === "hours") setView("minutes");
          }
        }}
      >
        <span
          className="quick-clock__hand"
          style={{
            transform: `rotate(${view === "hours" ? (h % 12) * 30 : m * 6}deg)`,
          }}
        />
        {Array.from({ length: 12 }, (_, index) => {
          const angle = (index * Math.PI) / 6;
          const n = view === "hours" ? index || 12 : index * 5;
          const selected = view === "hours" ? h % 12 === index : m === n;
          return (
            <span
              key={index}
              className={
                selected
                  ? "quick-clock__number quick-clock__number--active"
                  : "quick-clock__number"
              }
              style={{
                left: `${50 + Math.sin(angle) * 40}%`,
                top: `${50 - Math.cos(angle) * 40}%`,
              }}
            >
              {String(n).padStart(view === "minutes" ? 2 : 1, "0")}
            </span>
          );
        })}
      </div>
      <div className="quick-time-tabs">
        <button
          className="button button--ghost"
          aria-pressed={h < 12}
          onClick={() => setHour(String(h % 12).padStart(2, "0"))}
          type="button"
        >
          AM
        </button>
        <button
          className="button button--ghost"
          aria-pressed={h >= 12}
          onClick={() => setHour(String((h % 12) + 12).padStart(2, "0"))}
          type="button"
        >
          PM
        </button>
      </div>
      <div className={`quick-fields quick-clock-fields${seconds ? " quick-clock-fields--seconds" : ""}`}>
        <label className="field">
          <span className="field__label">Hour (0–23)</span>
          <input
            className="field__control"
            type="number"
            min="0"
            max="23"
            value={hour}
            onChange={(event) => setHour(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Minute (0–59)</span>
          <input
            className="field__control"
            type="number"
            min="0"
            max="59"
            value={minute}
            onChange={(event) => setMinute(event.target.value)}
          />
        </label>
        {seconds ? <label className="field"><span className="field__label">Second (0–59)</span><input className="field__control" type="number" min="0" max="59" value={second} onChange={event => setSecond(event.target.value)} /></label> : null}
      </div>
      <div className="decision-modal__actions">
        {onClear ? <button type="button" className="button button--ghost quick-time-clear" onClick={onClear}>Time unknown</button> : null}
        <button
          className="button button--ghost"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="button button--primary"
          disabled={selectedTime === null}
          onClick={() =>
            onApply(
              selectedTime!,
            )
          }
          type="button"
        >
          Apply time
        </button>
      </div>
    </ModalDialog>
  );
}
