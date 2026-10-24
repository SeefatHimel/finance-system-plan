import { sourceAttentionItems } from "@/lib/sms-statement-evidence";

type Source = Parameters<typeof sourceAttentionItems>[0];

export function SourceAttention({ statement, sms, latePosting }: { statement: Source; sms: Source; latePosting: boolean }) {
  const items = sourceAttentionItems(statement, sms, latePosting);
  return <div className={`source-attention${items.length ? " source-attention--has-items" : ""}`} aria-label="Source details needing attention">
    <strong>{items.length ? "Needs your attention" : "Source checks"}</strong>
    {items.length ? <ul>{items.map(item => <li className={`source-attention__item source-attention__item--${item.tone}`} key={item.key}>{item.text}</li>)}</ul>
      : <span>No key differences flagged. Verify the originals before pairing.</span>}
  </div>;
}
