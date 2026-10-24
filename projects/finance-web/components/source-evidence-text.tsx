import { sourceTextParts } from "@/lib/source-text-highlights";

type SourceFacts = Parameters<typeof sourceTextParts>[1];

export function SourceEvidenceText({ text, facts }: { text: string; facts: SourceFacts }) {
  const parts = sourceTextParts(text, facts);
  return <span className="source-evidence-text">{parts.map((part, index) => part.highlight
    ? <mark className={`source-evidence-mark source-evidence-mark--${part.highlight.kind}`} title={part.highlight.label} aria-label={`${part.highlight.label}: ${part.text}`} key={index}>{part.text}</mark>
    : <span key={index}>{part.text}</span>)}</span>;
}

export function SourceEvidenceLegend({ text, facts }: { text: string; facts: SourceFacts }) {
  const labels = [...new Map(sourceTextParts(text, facts).flatMap(part => part.highlight ? [[part.highlight.label, part.highlight.kind] as const] : [])).entries()];
  if (!labels.length) return null;
  return <div className="source-evidence-legend" aria-label="Facts highlighted in this source"><strong>Highlighted in source</strong>{labels.map(([label, kind]) => <span className={`source-evidence-legend__item source-evidence-legend__item--${kind}`} key={label}>{label}</span>)}</div>;
}
