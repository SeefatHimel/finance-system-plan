export type DatePeriod = { mode: "all" | "daily" | "monthly" | "custom"; start: string; end: string };
export const allDates: DatePeriod = { mode: "all", start: "", end: "" };

export function localDate(value = new Date()) {
  return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function monthPeriod(month = localDate().slice(0, 7)): DatePeriod {
  if (!/^\d{4}-\d{2}$/.test(month) || !parseDate(`${month}-01`)) return monthPeriod(localDate().slice(0, 7));
  const date = parseDate(`${month}-01`)!;
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return { mode: "monthly", start: `${month}-01`, end: date.toISOString().slice(0, 10) };
}

export function dailyPeriod(day = localDate()): DatePeriod {
  const valid = parseDate(day) ? day : localDate();
  return { mode: "daily", start: valid, end: valid };
}

export function shiftPeriod(period: DatePeriod, delta: number): DatePeriod {
  const date = parseDate(period.start) ?? parseDate(localDate())!;
  if (period.mode === "daily") {
    date.setUTCDate(date.getUTCDate() + delta);
    if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return period;
    return dailyPeriod(date.toISOString().slice(0, 10));
  }
  date.setUTCMonth(date.getUTCMonth() + delta, 1);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return period;
  return monthPeriod(date.toISOString().slice(0, 7));
}

export function dateRangeError(start: string, end: string) {
  const first = parseDate(start), last = parseDate(end);
  if (!first || !last) return "Enter valid start and end dates.";
  if (start > end) return "End date must be on or after start date.";
  if ((last.getTime() - first.getTime()) / 86400000 > 365) return "Choose a range of at most 366 days.";
  return "";
}

export function periodLabel(period: DatePeriod) {
  if (period.mode === "all") return "All dates";
  const format = (date: string) => new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parseDate(date)!);
  return period.start === period.end ? format(period.start) : `${format(period.start)} – ${format(period.end)}`;
}

export function periodBounds(period: DatePeriod) {
  return period.mode === "all" ? {} : { start_date: period.start, end_date: period.end };
}

export function dateInPeriod(value: string | null | undefined, period: DatePeriod) {
  if (period.mode === "all") return true;
  if (!value) return false;
  const day = value.length === 10 ? value : localDate(new Date(value));
  return day >= period.start && day <= period.end;
}

export function periodFromFilters(filters: { month?: string; start_date?: string; end_date?: string }, mode?: string): DatePeriod {
  if (filters.start_date && filters.end_date && !dateRangeError(filters.start_date, filters.end_date)) {
    return { mode: mode === "daily" || (mode !== "custom" && filters.start_date === filters.end_date) ? "daily" : "custom", start: filters.start_date, end: filters.end_date };
  }
  return filters.month ? monthPeriod(filters.month) : { ...allDates };
}
