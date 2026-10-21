import { Text, View } from "react-native";
import type { StatementSource } from "./api";
import { ui } from "./mobile-ui";
import { formatCalendarDate, formatClockTime } from "../../finance-contracts/presentation";

/** Read-only extraction. Never substitute reviewed ledger/draft fields as originals. */
export function StatementSourceEvidence({ source }: { source: StatementSource }) {
  const original = source.extracted;
  const text = original?.raw_text || original?.description;
  return <View style={ui.card}>
    <Text accessibilityRole="header" style={ui.text}>
      Original extracted row{original?.page != null ? ` · Page ${original.page}` : ""}{original?.row != null ? `, row ${original.row}` : ""}
    </Text>
    <Text style={ui.muted}>{formatCalendarDate(original?.date)} · {formatClockTime(original?.time)}</Text>
    <Text selectable style={ui.text}>{text || "Original extracted statement text is unavailable."}</Text>
    <Text style={ui.muted}>Source amount: {original?.amount ?? "Not reported"}{original?.direction ? ` · ${original.direction}` : ""} · Reported balance: {original?.balance_after ?? "Not reported"}</Text>
    {original?.signed_fee != null ? <Text style={ui.muted}>Source signed fee: {original.signed_fee}</Text> : null}
  </View>;
}
