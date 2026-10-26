/** Highlight parsed monetary values in the original text without rewriting it. */
export function reviewSourceSegments(body: string, values: (string | null | undefined)[]) {
  const amounts = new Set(values.map(value => monetaryCents(value ?? "")).filter((value): value is number => value !== null));
  if (!amounts.size) return [{ text: body, highlighted: false }];

  const segments: { text: string; highlighted: boolean }[] = [];
  const numbers = /\d[\d,]*(?:\.\d{1,2})?/g;
  let last = 0;
  for (const match of body.matchAll(numbers)) {
    const start = match.index;
    const end = start + match[0].length;
    // A card or account identifier is not a money amount, even if its suffix matches.
    if (start > 0 && /[\d*]/.test(body[start - 1])) continue;
    if (end < body.length && /[\d*.]/.test(body[end])) continue;
    const cents = monetaryCents(match[0]);
    if (cents === null || !amounts.has(cents)) continue;
    const context = body.slice(Math.max(0, start - 16), start);
    const moneyLabel = /(?:BDT|TK|amount|balance|fee)\s*[:.]?\s*$/i.test(context);
    if (!moneyLabel && !match[0].includes(".") && cents < 10000) continue;
    if (start > last) segments.push({ text: body.slice(last, start), highlighted: false });
    segments.push({ text: match[0], highlighted: true });
    last = end;
  }
  if (last < body.length) segments.push({ text: body.slice(last), highlighted: false });
  return segments.length ? segments : [{ text: body, highlighted: false }];
}

function monetaryCents(value: string) {
  const clean = value.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}
