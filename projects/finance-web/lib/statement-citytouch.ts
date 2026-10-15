/** Show separately retained Citytouch evidence without changing the saved draft. */
const maskedCitytouch = /(CT[-\s]*FT[-\s]*(?:\*{2,})?\d{4,24}[-\s]*)(\*{2,}\d{4,24})(?![A-Z0-9])/i;

export function displayedStatementText(text: string, extractedDescription: string, printedCode: string | null): string {
  if (!text || !extractedDescription || !printedCode || !/^\d{5,24}$/.test(printedCode)) return text;
  if (!text.includes(extractedDescription)) return text;
  const updatedSource = extractedDescription.replace(maskedCitytouch, (match, prefix: string, maskedSecond: string) => {
    const suffix = maskedSecond.replace(/^\*+/, "");
    return printedCode.endsWith(suffix) ? `${prefix}${printedCode}` : match;
  });
  return text.replace(extractedDescription, updatedSource);
}
