"use client";

import { useState } from "react";
import { DatePeriodControls } from "@/components/date-period-controls";
import { allDates, dateInPeriod, type DatePeriod } from "@/lib/date-period";

/** For complete, unpaginated collections; paginated views filter through the API. */
export function DatedList<T>({ items, fields, children, label }: {
  items: T[]; fields: { label: string; date: (item: T) => string | null | undefined }[];
  children: (items: T[]) => React.ReactNode; label: string;
}) {
  const [period, setPeriod] = useState<DatePeriod>(allDates);
  const [field, setField] = useState(0);
  const visible = items.filter(item => dateInPeriod(fields[field].date(item), period));
  return <>
    <DatePeriodControls label={`${label} dates`} description={`Based on ${fields[field].label.toLowerCase()}. Current totals stay live.`} value={period} onChange={setPeriod}>
      {fields.length > 1 ? <label className="field"><span className="field__label">Filter date</span><select aria-label="Filter date" className="field__control" value={field} onChange={event => setField(Number(event.target.value))}>{fields.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}</select></label> : null}
    </DatePeriodControls>
    {children(visible)}
  </>;
}
