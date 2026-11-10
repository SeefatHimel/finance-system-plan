import { localDay, newQuickDraft, type QuickDraft } from "../../finance-contracts/quick-add";
import type { Account, Category } from "./api";

/** A conservative local parser. Unrecognized details stay in the note for human review. */
export function voiceDraft(phrase: string, accounts: Account[], categories: Category[], now = new Date()): QuickDraft {
  const draft = newQuickDraft(undefined, now);
  const text = phrase.trim();
  const lower = text.toLowerCase();
  const amount = lower.match(/(?:bdt|taka|tk)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:bdt|taka|tk)/i);
  if (amount) draft.amount = (amount[1] ?? amount[2]).replaceAll(",", "");
  const time = lower.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (time) {
    const hour = Number(time[1]) % 12 + (time[3].toLowerCase().startsWith("p") ? 12 : 0);
    draft.time = `${String(hour).padStart(2, "0")}:${time[2] ?? "00"}`;
    draft.timeMode = "custom";
  }
  if (/\byesterday\b/.test(lower)) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    draft.date = localDay(yesterday);
    draft.dateMode = "custom";
  }
  if (/\b(income|earned|received|salary)\b/.test(lower)) draft.type = "income";
  const category = categories
    .filter(item => item.is_active !== false && (item.kind === draft.type || item.kind === "system"))
    .sort((a, b) => b.name.length - a.name.length)
    .find(item => lower.includes(item.name.toLowerCase()));
  if (category) draft.category = category.id;
  const active = accounts.filter(item => item.is_active !== false);
  // Never guess which ledger receives the entry when names overlap in speech.
  const namedMatches = active.filter(item => lower.includes(item.name.toLowerCase()));
  const named = namedMatches.length === 1 ? namedMatches[0] : undefined;
  const cash = active.filter(item => /cash|wallet/i.test(item.name) || item.type === "cash");
  draft.account = namedMatches.length > 1 ? "" : named?.id ?? (cash.length === 1 ? cash[0].id : active.length === 1 ? active[0].id : "");
  let note = text
    .replace(/^(?:add|create|record)\s+(?:a\s+)?(?:transaction|entry)\b[,:\s]*/i, "")
    .replace(/\b(?:today|yesterday)\b/gi, "")
    .replace(/\b(?:at|from)\s*$/i, "");
  if (amount) note = note.replace(amount[0], "");
  if (time) note = note.replace(time[0], "");
  if (category) note = note.replace(new RegExp(category.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "");
  draft.note = (note.replace(/\s{2,}/g, " ").replace(/^[,.:\s]+|[,.:\s]+$/g, "") || text).slice(0, 2000);
  return draft;
}
