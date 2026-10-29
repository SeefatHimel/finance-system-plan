"use client";

import { Clock } from '@phosphor-icons/react';
import { useState, type InputHTMLAttributes } from 'react';
import { QuickTimePicker } from './quick-time-picker';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: string | null; onValueChange: (value: string) => void;
};

/** Same clock affordance in every form; a blank optional time stays unknown. */
export function ClockTimeInput({ value, onValueChange, className = 'field__control', step = '1', ...props }: Props) {
  const [choosing, setChoosing] = useState(false);
  const current = value ?? '';
  const commit = (next: string) => { if (next !== current) onValueChange(next); };
  return <span className="clock-time-input">
    <input {...props} type="time" step={step} className={className} value={current} onChange={event => commit(event.target.value)} />
    <button className="clock-time-input__button" type="button" disabled={props.disabled || props.readOnly} aria-label={`Choose ${props['aria-label'] ?? 'time'} on clock`} onClick={() => setChoosing(true)}><Clock size={18} aria-hidden="true" /></button>
    {choosing ? <QuickTimePicker value={current} seconds={Number(step) < 60 || current.length > 5} onApply={next => { commit(next); setChoosing(false); }} onCancel={() => setChoosing(false)} onClear={props.required ? undefined : () => { commit(''); setChoosing(false); }} /> : null}
  </span>;
}
