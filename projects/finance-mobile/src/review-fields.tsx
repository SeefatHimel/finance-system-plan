import { Text, View } from "react-native";
import type { Account, Category, PaymentMethod } from "./api";
import { ActionButton, InputField, SearchSelect, ui } from "./mobile-ui";
import { NativeDateField, NativeTimeField } from "./native-time-field";
import { ClassificationFields } from "./classification-fields";
import { Disclosure } from "./disclosure";
export type ReviewDraft = {
  balanceAccountId: string;
  balanceAfter: string;
  balanceNotice: string;
  direction: string;
  accountId: string;
  amount: string;
  categoryId: string;
  counterpartyText: string;
  date: string;
  note: string;
  paymentMethodId: string;
  reference: string;
  time: string;
  transferAccountId: string;
  transactionType: string;
};
export function ReviewFields({
  draft,
  accounts,
  categories,
  paymentMethods,
  busy,
  onChange,
}: {
  draft: ReviewDraft;
  accounts: Account[];
  categories: Category[];
  paymentMethods: PaymentMethod[];
  busy: boolean;
  onChange: (patch: Partial<ReviewDraft>) => void;
}) {
  const accountOptions = accounts
    .filter(
      (item) =>
        item.is_active !== false ||
        item.id === draft.accountId ||
        item.id === draft.transferAccountId,
    )
    .map((item) => ({ id: item.id, name: item.name, detail: item.currency }));
  const name =
    accounts.find((item) => item.id === draft.accountId)?.name ??
    "Choose reporting account";
  return (
    <View style={{ gap: 14 }}>
      <ClassificationFields
        type={draft.transactionType}
        category={draft.categoryId}
        categories={categories}
        disabled={busy}
        onChange={(value) =>
          onChange({
            transactionType: value.type,
            categoryId: value.category,
            ...(value.direction && value.type !== "transfer"
              ? { direction: value.direction }
              : {}),
            ...(value.type !== "transfer" ? { transferAccountId: "" } : {}),
          })
        }
      />
      <SearchSelect
        label="Reporting account"
        value={draft.accountId}
        options={accountOptions}
        onChange={(accountId) =>
          onChange({
            accountId,
            paymentMethodId: "",
            ...(accountId === draft.transferAccountId
              ? { transferAccountId: "" }
              : {}),
          })
        }
        disabled={busy}
      />
      {draft.transactionType === "transfer" ? (
        <>
          <Text style={ui.text}>
            {draft.direction === "credit"
              ? `${draft.transferAccountId ? (accounts.find((item) => item.id === draft.transferAccountId)?.name ?? "Unknown account") : "Choose sender"} → ${name}`
              : `${name} → ${draft.transferAccountId ? (accounts.find((item) => item.id === draft.transferAccountId)?.name ?? "Unknown account") : "Choose destination"}`}
          </Text>
          <SearchSelect
            label={`Other transfer account · ${draft.direction === "credit" ? "From" : "To"}`}
            value={draft.transferAccountId}
            options={accountOptions.filter(
              (item) => item.id !== draft.accountId,
            )}
            emptyLabel="Choose other account"
            onChange={(transferAccountId) => onChange({ transferAccountId })}
            disabled={busy}
          />
        </>
      ) : null}
      <InputField
        label="Transaction amount"
        value={draft.amount}
        editable={!busy}
        keyboardType="decimal-pad"
        onChangeText={(amount) => onChange({ amount })}
      />
      {draft.balanceNotice ? (
        <Text accessibilityRole="alert" style={ui.error}>
          {draft.balanceNotice}
        </Text>
      ) : null}
      <InputField
        label={`Reported balance after · ${name}`}
        value={draft.balanceAfter}
        editable={!busy}
        keyboardType="numbers-and-punctuation"
        placeholder="Optional; zero is valid"
        onChangeText={(balanceAfter) =>
          onChange({
            balanceAfter,
            balanceAccountId: draft.accountId,
            balanceNotice: "",
          })
        }
      />
      <View style={ui.row}>
        <View style={{ flex: 1, minWidth: 150, gap: 6 }}>
          <Text style={ui.muted}>Date</Text>
          <NativeDateField
            label="Transaction date"
            value={draft.date}
            onChange={(date) => {
              if (!busy) onChange({ date });
            }}
          />
        </View>
        <View style={{ flex: 1, minWidth: 150, gap: 6 }}>
          <Text style={ui.muted}>Time</Text>
          <NativeTimeField
            label="Transaction time"
            value={draft.time}
            onChange={(time) => {
              if (!busy) onChange({ time });
            }}
          />
        </View>
      </View>
      <InputField
        label="Merchant / counterparty"
        value={draft.counterpartyText}
        editable={!busy}
        maxLength={255}
        onChangeText={(counterpartyText) => onChange({ counterpartyText })}
      />
      <InputField
        label="Reference"
        value={draft.reference}
        editable={!busy}
        maxLength={160}
        onChangeText={(reference) => onChange({ reference })}
      />
      <InputField
        label="Note"
        value={draft.note}
        editable={!busy}
        multiline
        maxLength={4000}
        onChangeText={(note) => onChange({ note })}
      />
      <Disclosure
        label={`Payment method · ${paymentMethods.find((item) => item.id === draft.paymentMethodId)?.name ?? "None"}`}
      >
        <SearchSelect
          label="Payment method"
          value={draft.paymentMethodId}
          options={paymentMethods
            .filter((item) => item.account === draft.accountId)
            .map((item) => ({ id: item.id, name: item.name }))}
          emptyLabel="No payment method"
          disabled={busy}
          onChange={(paymentMethodId) => onChange({ paymentMethodId })}
        />
        <Text style={ui.muted}>
          The saved card or wallet associated with the reporting account.
        </Text>
      </Disclosure>
    </View>
  );
}
