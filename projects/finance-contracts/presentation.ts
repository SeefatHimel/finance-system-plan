/** Pure presentation conventions shared by the web and native clients. */
export const PRODUCT_NAME = "Finance";
export const presentationColors = {
  accent: "#55e6a5",
  selected: "#12382f",
} as const;
const calendar = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
const timestamp = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatCurrency(
  value: string | number | null | undefined,
  currency = "BDT",
  absolute = false,
) {
  if (value === null || value === undefined || value === "")
    return "Not reported";
  const text =
    typeof value === "number"
      ? Number.isFinite(value)
        ? value.toFixed(2)
        : ""
      : value;
  const parts = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!parts) return "Amount unavailable";
  // Group decimal strings directly: no floating-point conversion or native Intl BigInt dependency.
  const whole = parts[2].replace(/^0+(?=\d)/, "");
  const fraction = (parts[3] ?? "").padEnd(2, "0");
  const negative = !absolute && parts[1] && /[1-9]/.test(whole + fraction);
  return `${negative ? "−" : ""}${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

export function formatMovementAmount(value: string, currency = "BDT") {
  return value === ""
    ? "Amount unavailable"
    : formatCurrency(value, currency, true);
}

export function formatCalendarDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    return "Unknown date";
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return "Unknown date";
  return calendar.format(date);
}

/** Timestamps use the viewer's local timezone; date-only values never shift. */
export function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? timestamp.format(date)
    : "Unknown date";
}

export function formatClockTime(value: string | null | undefined) {
  return value && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
    ? value
    : "Not reported";
}

export function displayLabel(value: string) {
  if (value === "sms") return "SMS";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function movementPresentation(
  movement: {
    type: string;
    direction: string;
    account: string;
    transfer_account: string | null;
  },
  accounts: ReadonlyMap<string, string>,
) {
  const source = accounts.get(movement.account) ?? "Unknown account";
  if (movement.type === "transfer") {
    const destination = movement.transfer_account
      ? (accounts.get(movement.transfer_account) ?? "Unknown account")
      : "Choose destination";
    return {
      path: `${source} → ${destination}`,
      sign: "",
      tone: "transfer" as const,
    };
  }
  return {
    path: source,
    sign: movement.direction === "credit" ? "+" : "−",
    tone:
      movement.direction === "credit"
        ? ("credit" as const)
        : ("debit" as const),
  };
}

/** Input fields share one local calendar interpretation of an absolute SMS timestamp. */
export function timestampFields(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: "", time: "" };
  return {
    date: `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  };
}
