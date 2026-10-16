const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  nativeHarness,
  input,
  button,
  text,
  React,
  create,
  act,
} = require("./helpers/native-harness.cjs");
const model = nativeHarness().load("transaction-draft");
const base = {
  id: "demo-entry",
  type: "expense",
  account: "bank",
  transfer_account: null,
  direction: "debit",
  amount: "100.07",
  date: "2026-10-01",
  time: null,
  category: null,
  payment_method: null,
  reference: "",
  counterparty_text: "Demo cafe",
  note: "",
  needs_review: false,
  balance_after: "0.00",
  transfer_evidence: [],
  updated_at: "2026-10-01T01:00:00Z",
  source: "sms",
};
test("editing a note sends only its patch, with zero and absent reported balances remaining different", () => {
  const draft = model.transactionDraft(base);
  assert.equal(draft.balances.bank, "0.00");
  assert.deepEqual(
    model.draftPatch(base, { ...draft, note: "Corrected note" }, false),
    { note: "Corrected note" },
  );
  assert.deepEqual(
    model.draftPatch(base, { ...draft, balances: { bank: "" } }, false),
    { balance_after: null },
  );
  assert.equal(
    model.draftPatch(base, { ...draft, balances: { bank: "-0.07" } }, false)
      .balance_after,
    "-0.07",
  );
  assert.equal(base.balance_after, "0.00");
});
test("receiving reports load on their own account; reversals and changing type never transplant balances", () => {
  const row = {
    ...base,
    type: "transfer",
    transfer_account: "wallet",
    balance_after: null,
    balance_reporting_account: "wallet",
    transfer_evidence: [
      { account: "bank", balance_after: null, is_primary: false },
      { account: "wallet", balance_after: "200.07", is_primary: true },
    ],
  };
  const draft = model.transactionDraft(row);
  assert.equal(draft.balances.wallet, "200.07");
  assert.equal(draft.reportingAccount, "wallet");
  const reversed = model.draftPatch(
    row,
    { ...draft, account: "wallet", transfer_account: "bank" },
    true,
  );
  assert.deepEqual(reversed.reported_balances, [
    { account: "wallet", balance_after: "200.07" },
    { account: "bank", balance_after: null },
  ]);
  const converted = model.draftPatch(
    row,
    { ...draft, type: "expense", account: "other" },
    true,
  );
  assert.equal(converted.balance_after, null);
  assert.equal(converted.transfer_account, null);
});
test("edit validation rejects invented days, invalid time, negative amounts and duplicate transfer endpoints", () => {
  const draft = model.transactionDraft(base);
  for (const patch of [
    { date: "2026-02-30" },
    { time: "25:00" },
    { amount: "-1" },
    { amount: "0.00" },
    { amount: "0.001" },
    { amount: "1000000000000.00" },
    { type: "transfer", transfer_account: "bank" },
  ])
    assert.throws(() => model.draftPatch(base, { ...draft, ...patch }, false));
  assert.equal(
    model.needsLinkedAcknowledgement(
      { ...base, statement_evidence_count: 1 },
      { ...draft, amount: "101.00" },
    ),
    true,
  );
  assert.equal(
    model.needsLinkedAcknowledgement(
      { ...base, statement_evidence_count: 1 },
      { ...draft, note: "New" },
    ),
    false,
  );
});
test("searchable choices preserve typing through option refresh, Cancel retains the choice and selection is explicit", async () => {
  const { SearchSelect } = nativeHarness().load("mobile-ui");
  let tree,
    chosen = "bank";
  const props = {
    label: "Account",
    value: chosen,
    options: [
      { id: "bank", name: "Demo bank" },
      { id: "wallet", name: "Demo wallet" },
    ],
    onChange: (value) => (chosen = value),
  };
  await act(async () => {
    tree = create(React.createElement(SearchSelect, props));
  });
  await act(async () => button(tree, "Account: Demo bank").props.onPress());
  const field = input(tree, "Search account");
  await act(async () => field.props.onChangeText("wal"));
  await act(async () =>
    tree.update(
      React.createElement(SearchSelect, {
        ...props,
        options: [...props.options],
      }),
    ),
  );
  assert.equal(input(tree, "Search account"), field);
  assert.equal(field.props.value, "wal");
  await act(async () => button(tree, "Cancel account").props.onPress());
  assert.equal(chosen, "bank");
  await act(async () => button(tree, "Account: Demo bank").props.onPress());
  await act(async () => button(tree, "Demo wallet").props.onPress());
  assert.equal(chosen, "wallet");
  assert.equal(tree.root.findAllByType("Modal").length, 0);
  await act(async () => tree.unmount());
});
test("full SMS is selectable and complete; retained UI never reveals a redacted body", async () => {
  const { SourceMessage } = nativeHarness().load("mobile-ui");
  let tree;
  const message = {
    sender: "DEMO",
    received_at: "2026-10-01T01:00:00Z",
    body: "Synthetic message\n".repeat(100),
    redacted_at: null,
  };
  await act(async () => {
    tree = create(React.createElement(SourceMessage, { message }));
  });
  await act(async () => button(tree, "View full SMS").props.onPress());
  assert(
    tree.root
      .findByType("Modal")
      .findAllByType("Text")
      .some(
        (node) => node.props.selectable && node.props.children === message.body,
      ),
  );
  await act(async () =>
    tree.update(
      React.createElement(SourceMessage, {
        message: { ...message, redacted_at: "2026-10-02T00:00:00Z" },
      }),
    ),
  );
  assert(!text(tree).includes("Synthetic message"));
  assert.match(text(tree), /unavailable or was removed/);
  await act(async () => tree.unmount());
});
test("review balance corrections survive type changes and clear visibly when a known reporting account changes", () => {
  const { updateReviewBalanceContext, reviewReportedBalance } =
    nativeHarness().load("review-balance");
  const draft = {
    accountId: "bank",
    balanceAccountId: "bank",
    balanceAfter: "0.00",
    balanceNotice: "",
    transactionType: "income",
  };
  const typed = updateReviewBalanceContext(draft, {
    transactionType: "transfer",
  });
  assert.equal(typed.balanceAfter, "0.00");
  const changed = updateReviewBalanceContext(typed, { accountId: "wallet" });
  assert.equal(changed.balanceAfter, "");
  assert.match(changed.balanceNotice, /account changed/);
  const corrected = updateReviewBalanceContext(changed, {
    balanceAfter: "200.07",
    balanceNotice: "",
  });
  assert.equal(
    reviewReportedBalance(
      corrected.balanceAfter,
      corrected.balanceAccountId,
      corrected.accountId,
    ),
    "200.07",
  );
});

test("incompatible category needs an explicit type choice; Cancel leaves classification unchanged", async () => {
  const { ClassificationFields } = nativeHarness().load(
    "classification-fields",
  );
  let tree,
    changes = [];
  const props = {
    type: "expense",
    category: "",
    categories: [
      { id: "income", name: "Demo salary", kind: "income", is_active: true },
    ],
    onChange: (value) => changes.push(value),
  };
  await act(async () => {
    tree = create(React.createElement(ClassificationFields, props));
  });
  await act(async () => button(tree, "Category: No category").props.onPress());
  await act(async () => button(tree, "Demo salary").props.onPress());
  assert.equal(changes.length, 0);
  assert.match(text(tree), /compatible transaction type/);
  await act(async () =>
    button(tree, "Cancel category/type change").props.onPress(),
  );
  assert.equal(changes.length, 0);
  await act(async () => button(tree, "Category: No category").props.onPress());
  await act(async () => button(tree, "Demo salary").props.onPress());
  await act(async () => button(tree, "Use Income").props.onPress());
  assert.deepEqual(changes, [
    { type: "income", category: "income", direction: "credit" },
  ]);
  await act(async () => tree.unmount());
});
test("account mismatch compares the ledger at the dated report; credit card references do not offer cash reconciliation", async () => {
  const { AccountSummary } = nativeHarness().load("account-summary");
  let tree;
  const account = {
    id: "demo",
    name: "Demo bank",
    type: "bank",
    currency: "BDT",
    is_active: true,
    ledger_balance: "1000.00",
    latest_reported_balance: "200.07",
    latest_reported_balance_date: "2026-10-01",
    ledger_balance_at_latest_report: "200.00",
    latest_reported_balance_difference: "0.07",
    reported_balance_comparison: "mismatch",
  };
  await act(async () => {
    tree = create(
      React.createElement(AccountSummary, { account, onReview: () => {} }),
    );
  });
  assert.match(text(tree), /Ledger at report: BDT 200.00/);
  assert.match(text(tree), /Reported minus ledger at report: BDT 0.07/);
  assert(button(tree, "Review balance difference for Demo bank"));
  await act(async () =>
    tree.update(
      React.createElement(AccountSummary, {
        account: { ...account, type: "credit_card" },
        onReview: () => {},
      }),
    ),
  );
  assert.match(text(tree), /Card balance reference/);
  assert(!button(tree, "Review balance difference for Demo bank"));
  await act(async () => tree.unmount());
});
test("review validation preserves zero, allows grouped reported balances and rejects invalid direction", () => {
  const { reviewDraftError } = nativeHarness().load("review-validation");
  const draft = {
    transactionType: "expense",
    direction: "debit",
    accountId: "bank",
    categoryId: "",
    paymentMethodId: "",
    amount: "100.07",
    balanceAfter: "0.00",
    date: "2026-10-01",
    time: "",
  };
  const accounts = [{ id: "bank", is_active: true }];
  assert.equal(reviewDraftError(draft, accounts, [], []), "");
  assert.equal(
    reviewDraftError({ ...draft, balanceAfter: "-1,200.07" }, accounts, [], []),
    "",
  );
  assert.match(
    reviewDraftError({ ...draft, direction: "invalid" }, accounts, [], []),
    /debit or credit/,
  );
});

test("a non-transfer editor never resurrects historical transfer balances", () => {
  const row = {
    ...base,
    balance_after: null,
    reported_balances: [],
    transfer_evidence: [
      { account: "bank", balance_after: "999.07", is_primary: true },
    ],
  };
  const draft = model.transactionDraft(row);
  assert.equal(draft.balances.bank, "");
  assert.deepEqual(
    model.draftPatch(row, { ...draft, note: "Correction" }, false),
    { note: "Correction" },
  );
});
