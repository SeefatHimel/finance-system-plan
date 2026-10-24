export type SourceTextHighlight = { text: string; label: string; kind: "amount" | "balance" | "date" | "identifier" | "direction" | "reference" };
export type SourceTextPart = { text: string; highlight?: SourceTextHighlight };

type SourceFacts = {
  amount?: string | null;
  balanceAfter?: string | null;
  date?: string | null;
  valueDate?: string | null;
  reference?: string | null;
  identifiers?: (string | null | undefined)[];
  direction?: string | null;
};

function amountForms(value: string | null | undefined) {
  if (!value || !/^\d[\d,]*(?:\.\d+)?$/.test(value.trim())) return [];
  const numeric = Number(value.replaceAll(",", ""));
  if (!Number.isFinite(numeric)) return [];
  const whole = Number.isInteger(numeric);
  return [...new Set([
    value.trim(), numeric.toFixed(2), numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ...(whole ? [String(numeric), numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })] : []),
  ])];
}

function dateForms(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return [];
  const [year, month, day] = value.split("-");
  const shortMonth = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
  return shortMonth ? [value, `${day}/${month}/${year}`, `${day}-${month}-${year}`, `${day}-${shortMonth}-${year.slice(2)}`, `${day}-${shortMonth}-${year}`] : [value];
}

/** Mark only facts actually present in the source text; never fabricate a highlighted match. */
export function sourceTextParts(text: string, facts: SourceFacts): SourceTextPart[] {
  const terms: SourceTextHighlight[] = [];
  const add = (forms: string[], label: string, kind: SourceTextHighlight["kind"]) => {
    forms.filter(form => form.length >= 4).forEach(form => terms.push({ text: form, label, kind }));
  };
  add(amountForms(facts.amount), "Amount", "amount");
  add(amountForms(facts.balanceAfter), "Reported balance after", "balance");
  add(dateForms(facts.date), "Date", "date");
  add(dateForms(facts.valueDate), "Value date", "date");
  if (facts.reference) add([facts.reference.trim()], "Reference", "reference");
  (facts.identifiers ?? []).forEach(identifier => { if (identifier) add([identifier.trim()], "Account or card", "identifier"); });
  if (facts.direction === "debit") add(["Cash WD", "Cash Withdrawal", "withdrawal", "debited"], "Debit wording", "direction");
  if (facts.direction === "credit") add(["credited", "deposited"], "Credit wording", "direction");
  terms.sort((a, b) => b.text.length - a.text.length);

  const lower = text.toLocaleLowerCase();
  const parts: SourceTextPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let next = text.length;
    let selected: SourceTextHighlight | undefined;
    for (const term of terms) {
      let index = lower.indexOf(term.text.toLocaleLowerCase(), cursor);
      const startsDigit = /\d/.test(term.text[0]);
      const startsLetter = /[a-z]/i.test(term.text[0]);
      const endsLetter = /[a-z]/i.test(term.text[term.text.length - 1]);
      while (index >= 0 && ((startsDigit && (/\d/.test(text[index - 1] ?? "") || /\d/.test(text[index + term.text.length] ?? "")))
        || (startsLetter && /[a-z]/i.test(text[index - 1] ?? ""))
        || (endsLetter && /[a-z]/i.test(text[index + term.text.length] ?? "")))) {
        index = lower.indexOf(term.text.toLocaleLowerCase(), index + 1);
      }
      if (index >= 0 && (index < next || (index === next && term.text.length > (selected?.text.length ?? 0)))) {
        next = index; selected = term;
      }
    }
    if (!selected) { parts.push({ text: text.slice(cursor) }); break; }
    if (next > cursor) parts.push({ text: text.slice(cursor, next) });
    parts.push({ text: text.slice(next, next + selected.text.length), highlight: selected });
    cursor = next + selected.text.length;
  }
  return parts;
}
