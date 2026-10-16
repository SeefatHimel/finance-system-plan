const groupedInteger = new Intl.NumberFormat("en-BD", {
  maximumFractionDigits: 0,
});

/** Keep decimal-string cents exact; the caller supplies the direction sign. */
export function formatMovementAmount(amount: string, currency = "BDT") {
  const parts = /^-?(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!parts) return "Amount unavailable";
  return `${currency} ${groupedInteger.format(BigInt(parts[1]))}.${(parts[2] ?? "").padEnd(2, "0")}`;
}

/** Unfiltered ledger views describe transfers neutrally, from sender to receiver. */
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
  const incoming = movement.direction === "credit";
  return {
    path: source,
    sign: incoming ? "+" : "−",
    tone: incoming ? ("credit" as const) : ("debit" as const),
  };
}
