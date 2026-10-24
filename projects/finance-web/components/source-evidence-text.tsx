import { sourceTextParts } from "@/lib/source-text-highlights";

type SourceFacts = Parameters<typeof sourceTextParts>[1];

export function SourceEvidenceText({ text, facts }: { text: string; facts: SourceFacts }) {
  const parts = sourceTextParts(text, facts);
  return <span className="source-evidence-text">{parts.map((part, index) => part.highlight
    ? <mark className={`source-evidence-mark source-evidence-mark--${part.highlight.kind}`} title={part.highlight.label} key={index}>{part.text}</mark>
    : <span key={index}>{part.text}</span>)}</span>;
}
