import { localDay } from "../../finance-contracts/quick-add";
import type { Transaction, TransactionActivityQuery } from "./api";

const activityDayFormatter = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type ActivityFilters = {
  search: string;
  account: string;
  category: string;
  type: string;
  mode: "all" | "daily" | "monthly" | "custom";
  start: string;
  end: string;
  ordering: "-date" | "-created_at" | "-updated_at";
};

export function initialActivityFilters(): ActivityFilters {
  return {
    search: "",
    account: "",
    category: "",
    type: "",
    mode: "all",
    start: localDay(),
    end: localDay(),
    ordering: "-date",
  };
}

export function activityQuery(
  filters: ActivityFilters,
): TransactionActivityQuery {
  const query: TransactionActivityQuery = {
    search: filters.search.trim(),
    account: filters.account,
    category: filters.category,
    type: filters.type,
    ordering: filters.ordering,
  };
  if (filters.mode === "monthly") query.month = filters.start.slice(0, 7);
  if (filters.mode === "daily" || filters.mode === "custom") {
    query.start_date = filters.start;
    query.end_date = filters.mode === "daily" ? filters.start : filters.end;
  }
  return query;
}

export function activityDateError(filters: ActivityFilters) {
  if (filters.mode === "all") return "";
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value.slice(0, 4) !== "0000" &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (
    !valid(filters.start) ||
    (filters.mode === "custom" && !valid(filters.end))
  )
    return "Choose a valid date.";
  if (filters.mode === "custom") {
    const days =
      (Date.parse(filters.end) - Date.parse(filters.start)) / 86400000;
    if (days < 0) return "End date must be on or after start date.";
    if (days > 365) return "Choose a range of at most 366 days.";
  }
  return "";
}

export function appendActivityPage(
  current: Transaction[],
  incoming: Transaction[],
) {
  const rows = new Map(current.map((row) => [row.id, row]));
  incoming.forEach((row) => rows.set(row.id, row));
  return [...rows.values()];
}

export function activityDay(
  row: Transaction,
  ordering: ActivityFilters["ordering"],
) {
  if (ordering === "-date") return row.date;
  // Added/updated calendar days follow the API's explicit Asia/Dhaka basis.
  const stamp = ordering === "-created_at" ? row.created_at : row.updated_at;
  const date = new Date(stamp);
  if (!Number.isFinite(date.getTime())) return "Unknown date";
  const parts = activityDayFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
