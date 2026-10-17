import { Text, View } from "react-native";
import type { Account, Category } from "./api";
import { ClassificationFields } from "./classification-fields";
import { CompactFields, CompactDateTime } from "./compact-form";
import { Disclosure } from "./disclosure";
import { InputField, SearchSelect, ui } from "./mobile-ui";

export type ManualEntryDraft = {
  account: string; category: string; type: string; direction: string;
  transfer_account: string; amount: string; balance_after: string;
  date: string; time: string; counterparty_text: string; note: string;
};
export function ManualEntryFields({ draft, accounts, categories, busy, error, onChange }: {
  draft: ManualEntryDraft; accounts: Account[]; categories: Category[];
  busy: boolean; error?: string; onChange: (patch: Partial<ManualEntryDraft>) => void;
}) {
  const options = accounts.filter(item => item.is_active !== false || item.id === draft.account || item.id === draft.transfer_account)
    .map(item => ({ id: item.id, name: item.name, detail: item.currency }));
  const name = accounts.find(item => item.id === draft.account)?.name ?? "Choose account";
  return <View style={[ui.card, { gap: 12 }]}>
    <ClassificationFields type={draft.type} category={draft.category} categories={categories} disabled={busy} onChange={onChange} />
    <CompactFields>
      <SearchSelect key="account" label="Reporting account" value={draft.account} options={options} disabled={busy}
        onChange={account => onChange({ account, ...(account === draft.transfer_account ? { transfer_account: "" } : {}) })} />
      {draft.type === "transfer" ? <View key="transfer" style={{ gap: 8 }}>
        <SearchSelect label="Debit / credit" value={draft.direction} disabled={busy} options={[
          { id: "debit", name: "Debit · money out" }, { id: "credit", name: "Credit · money in" },
        ]} onChange={direction => onChange({ direction })} />
        <SearchSelect label={`Other transfer account · ${draft.direction === "credit" ? "From" : "To"}`}
          value={draft.transfer_account} options={options.filter(item => item.id !== draft.account)} disabled={busy}
          onChange={transfer_account => onChange({ transfer_account })} />
        <Text style={ui.muted}>{draft.direction === "credit" ? `Money into ${name}` : `Money out of ${name}`}</Text>
      </View> : null}
      <InputField key="amount" label="Amount" value={draft.amount} keyboardType="decimal-pad" editable={!busy}
        onChangeText={amount => onChange({ amount })} />
      <InputField key="balance" label={`Reported balance after · ${name}`} value={draft.balance_after} keyboardType="numbers-and-punctuation"
        editable={!busy} placeholder="Optional; zero is valid" onChangeText={balance_after => onChange({ balance_after })} />
      <CompactDateTime key="datetime" date={draft.date} time={draft.time} disabled={busy}
        onDate={date => onChange({ date })} onTime={time => onChange({ time })} />
      <InputField key="merchant" label="Merchant / counterparty" value={draft.counterparty_text} editable={!busy} maxLength={255}
        onChangeText={counterparty_text => onChange({ counterparty_text })} />
    </CompactFields>
    <Disclosure label="More details" revealKey={error}>
      <InputField label="Note" value={draft.note} editable={!busy} multiline maxLength={4000} onChangeText={note => onChange({ note })} />
    </Disclosure>
  </View>;
}
