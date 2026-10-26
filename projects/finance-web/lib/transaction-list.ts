/** Presentation pagination covers the complete filtered collection returned by the API. */
export function transactionPage(total: number, page: number, size: number) {
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.max(1, Math.min(pages, Number.isSafeInteger(page) ? page : 1));
  const start = (current - 1) * size;
  return { current, pages, start, end: Math.min(total, start + size) };
}

export function transactionPageParams(params: URLSearchParams) {
  const requested = Number(params.get("page"));
  const size = Number(params.get("page_size"));
  return {
    page: Number.isSafeInteger(requested) && requested > 0 ? requested : 1,
    pageSize: [25, 50, 100].includes(size) ? size : 25,
  };
}

/** v1 stored Time separately. Migrate it to Date & time without losing other choices. */
export function transactionColumnPreferences(value: unknown, allowed: readonly string[]) {
  if (!Array.isArray(value)) return [];
  const selected = new Set(value.map(item => item === "time" ? "date" : item));
  return allowed.filter(column => selected.has(column));
}

export function transactionPeriodFilters(period: { mode: string; start: string; end: string }) {
  return {
    month: period.mode === "monthly" ? period.start.slice(0, 7) : "",
    start_date: period.mode === "daily" || period.mode === "custom" ? period.start : "",
    end_date: period.mode === "daily" || period.mode === "custom" ? period.end : "",
  };
}

export function transactionPeriodCaption(period: { mode: string; start: string; end: string }) {
  if (period.mode === "all") return "All dates";
  const format = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  if (period.mode === "monthly") return format(period.start, { month: "long", year: "numeric" });
  if (period.mode === "daily") return format(period.start, { day: "numeric", month: "short", year: "numeric" });
  // Include both years for ranges crossing New Year so the compact label stays unambiguous.
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", ...(period.start.slice(0, 4) !== period.end.slice(0, 4) ? { year: "numeric" } : {}) };
  return `${format(period.start, options)} – ${format(period.end, options)}`;
}
