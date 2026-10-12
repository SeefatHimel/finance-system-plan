import type { QuickAddPreset, QuickEntry } from "./generated/types";

export type QuickPreset = Required<QuickAddPreset>;
export type PresetInput = Omit<QuickPreset, "id" | "available">;
export type QuickEntryInput = Required<QuickEntry>;
export type QuickDraft = {
  account: string;
  category: string;
  type: "expense" | "income";
  amount: string;
  counterparty_text: string;
  note: string;
  date: string;
  time: string;
  dateMode: "today" | "custom";
  timeMode: "now" | "custom" | "none";
};
export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function localTime(now = new Date()) {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}
export function blankPreset(): PresetInput {
  return {
    name: "",
    type: "expense",
    account: null,
    category: null,
    amount: null,
    note: "",
    counterparty_text: "",
    is_enabled: true,
    is_favorite: true,
    display_order: 0,
  };
}
export function newQuickDraft(
  preset?: QuickPreset,
  now = new Date(),
): QuickDraft {
  return {
    account: preset?.account ?? "",
    category: preset?.category ?? "",
    type: preset?.type ?? "expense",
    amount: preset?.amount ?? "",
    note: preset?.note ?? "",
    counterparty_text: preset?.counterparty_text ?? "",
    date: localDay(now),
    time: localTime(now),
    dateMode: "today",
    timeMode: "now",
  };
}
export function applyQuickPreset(
  draft: QuickDraft,
  preset: QuickPreset,
): QuickDraft {
  return {
    ...draft,
    account: preset.account ?? "",
    category: preset.category ?? "",
    type: preset.type,
    amount: draft.amount || preset.amount || "",
    note: draft.note || preset.note,
    counterparty_text: draft.counterparty_text || preset.counterparty_text,
  };
}
export function categoryFits(kind: string, type: string) {
  return kind === type || kind === "system";
}
export function newEntryId() {
  // This is a request identity, not an authentication token. Native JS may lack crypto.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (character) => {
      const n = Math.floor(Math.random() * 16);
      return (character === "x" ? n : (n & 3) | 8).toString(16);
    },
  );
}
export function validDay(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export function buildQuickEntry(
  draft: QuickDraft,
  id: string,
  source: "web" | "mobile",
  now = new Date(),
): QuickEntryInput {
  if (!draft.account) throw new Error("Choose an account.");
  const amount = draft.amount.trim().replaceAll(",", "");
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)
    throw new Error("Enter a positive amount with at most two decimal places.");
  const date = draft.dateMode === "today" ? localDay(now) : draft.date;
  if (!validDay(date)) throw new Error("Choose a valid date.");
  const time =
    draft.timeMode === "none"
      ? null
      : draft.timeMode === "now"
        ? localTime(now)
        : draft.time;
  if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Choose a valid time.");
  if (draft.note.length > 2000)
    throw new Error("Keep the note within 2,000 characters.");
  return {
    client_request_id: id,
    account: draft.account,
    category: draft.category || null,
    type: draft.type,
    source,
    amount,
    date,
    time,
    counterparty_text: draft.counterparty_text,
    note: draft.note,
  };
}
export function isRejectedEntry(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "status" in error &&
      [400, 403, 404, 422].includes(Number(error.status)),
  );
}

export function entrySnapshot(
  value: unknown,
  source: "web" | "mobile",
): QuickEntryInput {
  const input = value as QuickEntryInput;
  if (
    !input ||
    input.source !== source ||
    typeof input.client_request_id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(input.client_request_id) ||
    typeof input.account !== "string" ||
    !input.account ||
    !["expense", "income"].includes(input.type) ||
    (input.category !== null && typeof input.category !== "string") ||
    typeof input.amount !== "string" ||
    !/^\d{1,12}(?:\.\d{1,2})?$/.test(input.amount) ||
    Number(input.amount) <= 0 ||
    typeof input.date !== "string" ||
    !validDay(input.date) ||
    (input.time !== null &&
      (typeof input.time !== "string" ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))) ||
    typeof input.note !== "string" ||
    typeof input.counterparty_text !== "string"
  )
    throw new Error(
      "The saved retry request is invalid. Review your ledger before discarding it.",
    );
  return input;
}
export function draftFromEntry(input: QuickEntryInput): QuickDraft {
  return {
    account: input.account,
    category: input.category ?? "",
    type: input.type,
    amount: input.amount,
    counterparty_text: input.counterparty_text,
    note: input.note,
    date: input.date,
    time: input.time ?? "",
    dateMode: "custom",
    timeMode: input.time === null ? "none" : "custom",
  };
}
