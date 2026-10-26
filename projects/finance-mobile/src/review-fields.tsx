import { Pressable, Text, View } from "react-native";
import type { Account, Category, PaymentMethod } from "./api";
import { InputField, SearchSelect, useMobileUi } from "./mobile-ui";
import { CompactFields, CompactDateTime } from "./compact-form";
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
  error,
  rememberChoices,
  onRememberChoicesChange,
  onChange,
}: {
  draft: ReviewDraft;
  accounts: Account[];
  categories: Category[];
  paymentMethods: PaymentMethod[];
  busy: boolean;
  error?: string;
  rememberChoices: boolean;
  onRememberChoicesChange: (value: boolean) => void;
  onChange: (patch: Partial<ReviewDraft>) => void;
}) {
  const ui = useMobileUi();
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
      {draft.balanceNotice ? (
        <Text accessibilityRole="alert" style={ui.error}>
          {draft.balanceNotice}
        </Text>
      ) : null}
      <CompactFields>
        <SearchSelect key="account"
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
          <View key="transfer" style={{ gap: 8 }}>
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
          </View>
        ) : null}
        <InputField key="amount"
          label="Transaction amount"
          value={draft.amount}
          editable={!busy}
          keyboardType="decimal-pad"
          onChangeText={(amount) => onChange({ amount })}
        />
        <InputField key="balance"
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
        <CompactDateTime key="datetime" date={draft.date} time={draft.time} disabled={busy}
          onDate={date => onChange({ date })} onTime={time => onChange({ time })} />
        <InputField key="merchant"
          label="Merchant / counterparty"
          value={draft.counterpartyText}
          editable={!busy}
          maxLength={255}
          onChangeText={(counterpartyText) => onChange({ counterpartyText })}
        />
      </CompactFields>
      <Disclosure label="More details" revealKey={error}>
        <CompactFields>
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
        </CompactFields>
        <Pressable accessibilityRole="checkbox" accessibilityLabel="Use these choices for similar SMS" accessibilityState={{ checked: rememberChoices, disabled: busy }}
          disabled={busy} onPress={() => onRememberChoicesChange(!rememberChoices)} style={ui.button}>
          <Text style={ui.text}>{rememberChoices ? "☑" : "☐"} Use these choices for similar SMS</Text>
          <Text style={ui.muted}>Optional. Saves a suggestion for this sender and message kind after confirmation.</Text>
        </Pressable>
      </Disclosure>
    </View>
  );
}
