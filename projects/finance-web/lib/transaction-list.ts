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
