import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  type Account,
  type Category,
  type PaymentMethod,
  type Transaction,
  type TransactionSourceMessage,
  type StatementSource,
  getTransaction,
  getTransactionSourceMessages,
  getTransactionStatements,
  updateTransaction,
} from "./api";
import {
  transactionDraft,
  draftPatch,
  needsLinkedAcknowledgement,
  categoryTypes,
  type TransactionDraft,
} from "./transaction-draft";
import {
  ActionButton,
  InputField,
  ModalFrame,
  SearchSelect,
  SourceMessage,
  ui,
} from "./mobile-ui";
import { ClassificationFields } from "./classification-fields";
import { NativeDateField, NativeTimeField } from "./native-time-field";
import { Disclosure } from "./disclosure";
import {
  formatCalendarDate,
  formatCurrency,
  formatClockTime,
} from "../../finance-contracts/presentation";
export function TransactionEditor({
  id,
  token,
  scope,
  accounts,
  categories,
  paymentMethods,
  onClose,
  onSaved,
  isCurrent = () => true,
}: {
  id: string;
  token: string;
  scope: string;
  accounts: Account[];
  categories: Category[];
  paymentMethods: PaymentMethod[];
  onClose: () => void;
  isCurrent?: () => boolean;
  onSaved: (row: Transaction) => void;
}) {
  const [row, setRow] = useState<Transaction | null>(null),
    [draft, setDraft] = useState<TransactionDraft | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [epoch, setEpoch] = useState(0);
  const [sources, setSources] = useState<TransactionSourceMessage[]>([]),
    [statements, setStatements] = useState<StatementSource[]>([]),
    [sourceError, setSourceError] = useState(""),
    [sourcesLoading, setSourcesLoading] = useState(true),
    [ack, setAck] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const ownerCheck = useRef(isCurrent);
  ownerCheck.current = isCurrent;
  const alive = useRef(true),
    inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setAck(false);
    setSourcesLoading(true);
    setSourceError("");
    setSources([]);
    setStatements([]);
    void getTransaction(tokenRef.current, id, abort.signal)
      .then((saved) => {
        if (current && ownerCheck.current()) {
          setRow(saved);
          setDraft(transactionDraft(saved));
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (current && ownerCheck.current()) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load transaction.",
          );
          setLoading(false);
        }
      });
    void Promise.allSettled([
      getTransactionSourceMessages(tokenRef.current, id, abort.signal),
      getTransactionStatements(tokenRef.current, id, abort.signal),
    ]).then(([messages, pdfs]) => {
      if (!current || !ownerCheck.current()) return;
      setSources(messages.status === "fulfilled" ? messages.value : []);
      setStatements(pdfs.status === "fulfilled" ? pdfs.value : []);
      setSourceError(
        messages.status === "rejected" || pdfs.status === "rejected"
          ? "Some source evidence could not load. Reload before correcting linked amounts, accounts or type."
          : "",
      );
      setSourcesLoading(false);
    });
    return () => {
      current = false;
      abort.abort();
    };
  }, [id, scope, epoch]);
  const linked = Boolean(
    row && draft && needsLinkedAcknowledgement(row, draft),
  );
  const name = (account: string) =>
    accounts.find((item) => item.id === account)?.name ?? "Unknown account";
  function change(patch: Partial<TransactionDraft>) {
    if (inFlight.current) return;
    setDraft((current) => (current ? { ...current, ...patch } : null));
    setAck(false);
    setError("");
  }
  async function save() {
    if (!row || !draft || inFlight.current) return;
    try {
      const chosen = accounts.find((item) => item.id === draft.account);
      if (!chosen || (chosen.is_active === false && chosen.id !== row.account))
        throw new Error("Choose an active account.");
      if (
        draft.type === "transfer" &&
        !accounts.some(
          (item) =>
            item.id === draft.transfer_account &&
            (item.is_active !== false || item.id === row.transfer_account),
        )
      )
        throw new Error("Choose an active destination account.");
      if (linked && (!ack || sourceError || sourcesLoading))
        throw new Error(
          sourceError ||
            (sourcesLoading
              ? "Wait for linked source evidence before confirming this correction."
              : "") ||
            "Review the linked sources and confirm the correction before saving.",
        );
      const selectedCategory = categories.find(
        (item) => item.id === draft.category,
      );
      const allowed = categoryTypes(selectedCategory?.kind);
      if (
        draft.category &&
        (!selectedCategory ||
          (selectedCategory.is_active === false &&
            draft.category !== row.category) ||
          (allowed && !allowed.includes(draft.type)))
      )
        throw new Error(
          "Choose a category compatible with this transaction type.",
        );
      if (
        draft.payment_method &&
        !paymentMethods.some(
          (item) =>
            item.id === draft.payment_method && item.account === draft.account,
        )
      )
        throw new Error("Choose a payment method for this account, or none.");
      const patch = draftPatch(row, draft, linked && ack);
      if (!Object.keys(patch).length) {
        onClose();
        return;
      }
      inFlight.current = true;
      setBusy(true);
      setError("");
      const fresh = await getTransaction(tokenRef.current, row.id);
      if (!alive.current || !ownerCheck.current()) return;
      if (fresh.updated_at !== row.updated_at)
        throw new Error(
          "This transaction changed since you opened it. Discard edits and reload the saved entry before trying again.",
        );
      const saved = await updateTransaction(tokenRef.current, row.id, patch);
      if (alive.current && ownerCheck.current()) onSaved(saved);
    } catch (reason) {
      if (alive.current && ownerCheck.current())
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not save transaction.",
        );
    } finally {
      inFlight.current = false;
      if (alive.current && ownerCheck.current()) setBusy(false);
    }
  }
  const primary = draft
    ? draft.type === "transfer" &&
      [draft.account, draft.transfer_account].includes(draft.reportingAccount)
      ? draft.reportingAccount
      : draft.account
    : "";
  const other =
    draft?.type === "transfer"
      ? primary === draft.account
        ? draft.transfer_account
        : draft.account
      : "";
  const accountOptions = accounts.map((item) => ({
    id: item.id,
    name: item.name,
    detail: `${item.currency}${item.is_active === false ? " · Inactive" : ""}`,
  }));
  return (
    <ModalFrame
      title="Edit transaction"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {error ? (
            <Text
              accessibilityRole="alert"
              style={[ui.error, { width: "100%" }]}
            >
              {error}
            </Text>
          ) : null}
          <ActionButton
            label="Cancel editing"
            disabled={busy}
            onPress={onClose}
          />
          <ActionButton
            label={busy ? "Saving transaction…" : "Save changes"}
            primary
            disabled={busy || loading || !draft}
            onPress={() => void save()}
          />
        </>
      }
    >
      {loading ? <ActivityIndicator color="#55e6a5" /> : null}
      {error ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={ui.error}>
            {error}
          </Text>
          <ActionButton
            label="Discard edits & reload"
            disabled={busy}
            onPress={() => setEpoch((value) => value + 1)}
          />
        </View>
      ) : null}
      {sourcesLoading ? (
        <Text style={ui.muted}>Loading source evidence…</Text>
      ) : null}
      {sourceError ? (
        <Text accessibilityRole="alert" style={ui.error}>
          {sourceError}
        </Text>
      ) : null}
      {sources.map((message) => (
        <SourceMessage key={message.id} message={message} />
      ))}
      {statements.map((source) => (
        <Disclosure key={source.id} label="Linked statement row">
          <Text selectable style={ui.text}>
            {source.description ||
              source.extracted?.description ||
              "Statement row"}
          </Text>
          <Text style={ui.muted}>
            {formatCalendarDate(source.date)} · {formatClockTime(source.time)} ·
            Amount {formatCurrency(source.amount)} · Balance{" "}
            {formatCurrency(source.balance_after)}
          </Text>
          {source.extracted?.raw_text ? (
            <Text selectable style={ui.text}>
              {source.extracted.raw_text}
            </Text>
          ) : null}
        </Disclosure>
      ))}
      {row && draft && !loading ? (
        <>
          <ClassificationFields
            type={draft.type}
            category={draft.category}
            categories={categories}
            disabled={busy}
            onChange={change}
          />
          <SearchSelect
            label={draft.type === "transfer" ? "From account" : "Account"}
            value={draft.account}
            options={accountOptions}
            disabled={busy}
            onChange={(account) => change({ account, payment_method: "" })}
          />
          {draft.type === "transfer" ? (
            <>
              <SearchSelect
                label="To account"
                value={draft.transfer_account}
                options={accountOptions.filter(
                  (item) => item.id !== draft.account,
                )}
                disabled={busy}
                onChange={(transfer_account) => change({ transfer_account })}
              />
              <Text style={ui.text}>
                {name(draft.account)} →{" "}
                {draft.transfer_account
                  ? name(draft.transfer_account)
                  : "Choose destination"}
              </Text>
              <ActionButton
                label="Reverse transfer direction"
                disabled={busy}
                onPress={() =>
                  change({
                    account: draft.transfer_account,
                    transfer_account: draft.account,
                    payment_method: "",
                  })
                }
              />
            </>
          ) : (
            <SearchSelect
              label="Debit / credit"
              value={draft.direction}
              options={[
                { id: "debit", name: "Debit · money out" },
                { id: "credit", name: "Credit · money in" },
              ]}
              disabled={busy}
              onChange={(direction) => change({ direction })}
            />
          )}
          <InputField
            label="Amount"
            value={draft.amount}
            keyboardType="decimal-pad"
            editable={!busy}
            onChangeText={(amount) => change({ amount })}
          />
          <InputField
            label={`Reported balance after · ${name(primary)}`}
            value={draft.balances[primary] ?? ""}
            keyboardType="numbers-and-punctuation"
            editable={!busy}
            placeholder="Optional"
            onChangeText={(value) =>
              change({ balances: { ...draft.balances, [primary]: value } })
            }
          />
          {other ? (
            <Disclosure label={`Other reported balance · ${name(other)}`}>
              <InputField
                label={`Reported balance after · ${name(other)}`}
                value={draft.balances[other] ?? ""}
                keyboardType="numbers-and-punctuation"
                editable={!busy}
                placeholder="Optional"
                onChangeText={(value) =>
                  change({ balances: { ...draft.balances, [other]: value } })
                }
              />
            </Disclosure>
          ) : null}
          <Text style={ui.muted}>
            Reported balances stay attached to their accounts; they do not move
            money.
          </Text>
          {!busy ? (
            <View style={ui.row}>
              <View style={{ flex: 1, minWidth: 150, gap: 6 }}>
                <Text style={ui.muted}>Date</Text>
                <NativeDateField
                  label="Transaction date"
                  value={draft.date}
                  onChange={(date) => change({ date })}
                />
              </View>
              <View style={{ flex: 1, minWidth: 150, gap: 6 }}>
                <Text style={ui.muted}>Time</Text>
                <NativeTimeField
                  label="Transaction time"
                  value={draft.time}
                  onChange={(time) => change({ time })}
                />
              </View>
            </View>
          ) : null}
          <InputField
            label="Merchant / counterparty"
            value={draft.counterparty_text}
            editable={!busy}
            maxLength={255}
            onChangeText={(counterparty_text) => change({ counterparty_text })}
          />
          <InputField
            label="Reference"
            value={draft.reference}
            editable={!busy}
            maxLength={160}
            onChangeText={(reference) => change({ reference })}
          />
          <InputField
            label="Note"
            value={draft.note}
            editable={!busy}
            multiline
            maxLength={4000}
            onChangeText={(note) => change({ note })}
          />
          <Disclosure label="More details">
            <SearchSelect
              label="Payment method"
              value={draft.payment_method}
              emptyLabel="No payment method"
              options={paymentMethods
                .filter((item) => item.account === draft.account)
                .map((item) => ({ id: item.id, name: item.name }))}
              disabled={busy}
              onChange={(payment_method) => change({ payment_method })}
            />
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: draft.needs_review,
                disabled: busy,
              }}
              disabled={busy}
              onPress={() => change({ needs_review: !draft.needs_review })}
              style={ui.button}
            >
              <Text style={ui.text}>
                {draft.needs_review ? "☑" : "☐"} Needs review
              </Text>
            </Pressable>
            <Text style={ui.muted}>
              Source: {row.source}. Original identifiers and evidence stay with
              the saved record.
            </Text>
          </Disclosure>
          {linked ? (
            <View style={ui.card}>
              <Text style={ui.error}>
                This changes an entry with linked source evidence. Check the
                sources above before continuing.
              </Text>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: ack,
                  disabled: busy || sourcesLoading || Boolean(sourceError),
                }}
                disabled={busy || sourcesLoading || Boolean(sourceError)}
                onPress={() => setAck((value) => !value)}
                style={ui.button}
              >
                <Text style={ui.text}>
                  {ack ? "☑" : "☐"} I reviewed the sources and confirm this
                  correction
                </Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}
    </ModalFrame>
  );
}
