const fieldLabels: Record<string, string> = {
  account: "Account", transfer_account: "Other transfer account", amount: "Amount",
  balance_after: "Reported balance", category: "Category", type: "Type",
  direction: "Debit / credit", payment_method: "Payment method", reference: "Reference",
  allow_linked_correction: "Linked transfer correction", match_transaction: "Transfer match",
  match_candidate: "Matching message", candidate: "Message", non_field_errors: "",
  detail: "", error: "", message: ""
};

function messages(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(messages);
  if (value && typeof value === "object") return Object.values(value).flatMap(messages);
  return [];
}

export async function responseError(response: Response): Promise<Error> {
  const fallback = response.status === 403 ? "You do not have permission to perform this action."
    : response.status === 404 ? "This item is no longer available. Refresh the page and try again."
    : response.status === 409 ? "This item changed while you were working. Refresh and try again."
    : response.status === 429 ? "Too many requests. Please wait and try again."
    : response.status >= 500 ? "The service is temporarily unavailable. Please try again."
    : "Check the entered details and try again.";
  // Server failures may contain HTML or debugging details; never display those bodies.
  if (response.status >= 500 || response.status === 429) return new Error(fallback);
  try {
    const payload: unknown = await response.json();
    const lines = payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.entries(payload).flatMap(([field, value]) => {
          const label = fieldLabels[field] ?? field.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
          return messages(value).map((message) => label ? `${label}: ${message}` : message);
        })
      : messages(payload);
    return new Error(lines.length ? [...new Set(lines)].slice(0, 4).join(" ").slice(0, 600) : fallback);
  } catch {
    return new Error(fallback);
  }
}

export async function fetchWithConnectionError(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "AbortError"
      ? "The request was cancelled. Please try again."
      : "Could not reach the service. Check your connection and try again.");
  }
}
