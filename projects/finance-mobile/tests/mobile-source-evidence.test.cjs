const { test } = require("node:test"), assert = require("node:assert/strict");
const { nativeHarness, React, create, act, input, button, text, deferred } = require("./helpers/native-harness.cjs");
const { mobileAppHarness } = require("./helpers/mobile-app-harness.cjs");
const message = { id: "synthetic-sms", sender: "DEMO", received_at: "2026-10-01T12:34:56Z", body: "Synthetic full original SMS\n".repeat(40), redacted_at: null };
const source = { id: "synthetic-statement", date: "2026-10-02", time: "13:00:00", description: "Reviewed description", amount: "12.37", balance_after: "250.00",
  extracted: { page: 2, row: 7, date: "2026-10-01", time: "12:34:56", description: "Original statement description", raw_text: "Original extracted statement row\n".repeat(30), direction: "debit", amount: "12.00", balance_after: "0.00", signed_fee: "0.37" } };
const row = { id: "synthetic-entry", account: "bank", transfer_account: null, type: "expense", direction: "debit", category: null, payment_method: null,
  date: "2026-10-01", time: "12:34:56", amount: "12.37", balance_after: "250.00", counterparty_text: "Synthetic Cafe", note: "", reference: "DEMO",
  needs_review: false, source: "sms", statement_evidence_count: 1, transfer_evidence: [], updated_at: "2026-10-01T13:00:00Z" };

test("mobile review expands full SMS inline, retains draft/input identity and never saves by expanding", async t => {
  let writes = 0;
  const candidate = { id: "review-a", status: "needs_review", transaction: null, account: "bank", destination_account: null,
    category: "food", amount: "12.37", balance_after: "250.00", reference: "DEMO", transaction_type: "expense", message_kind: "card_purchase",
    provider: "demo", confidence: "0.9", counterparty_text: "Synthetic Cafe", payment_method: null, raw_message: message };
  const h = await mobileAppHarness(t, { listMessageCandidates: async () => ({ count: 1, results: [candidate] }), confirmMessageCandidate: async () => { writes++; } });
  await h.review();
  await act(async () => button(h.tree, "Edit transaction details").props.onPress());
  await act(async () => button(h.tree, "More details").props.onPress());
  await act(async () => input(h.tree, "Note").props.onChangeText("Keep exact unsaved notes"));
  const field = input(h.tree, "Note"), before = { ...h.fields().props.draft };
  await act(async () => button(h.tree, "Show full original SMS").props.onPress());
  const body = h.tree.root.findAllByType("Text").find(node => node.props.selectable && node.props.numberOfLines === undefined);
  assert(body); assert(text(h.tree).includes(message.body));
  assert.equal(button(h.tree, "Collapse original SMS").props.accessibilityState.expanded, true);
  assert.equal(button(h.tree, "View full SMS"), undefined, "compact review keeps the full source inline");
  await act(async () => h.nav.navigate("more"));
  await act(async () => h.nav.goBack());
  assert.equal(input(h.tree, "Note"), field); assert.deepEqual(h.fields().props.draft, before);
  assert.equal(button(h.tree, "Collapse original SMS").props.accessibilityState.expanded, true);
  await act(async () => button(h.tree, "Collapse original SMS").props.onPress());
  assert.equal(body.props.numberOfLines, 2); assert.equal(writes, 0);
});

test("editor source sections reveal full originals with one toggle without changing edits, consent or requests", async t => {
  const evidence = deferred(); let tree, reads = 0, writes = 0, submitted;
  const h = nativeHarness({ getTransaction: async () => { reads++; return row; }, getTransactionSourceMessages: () => evidence.promise,
    getTransactionStatements: async () => [source], updateTransaction: async (_token, _id, patch) => { writes++; submitted = patch; return row; } });
  const { TransactionEditor } = h.load("transaction-editor");
  const props = { id: row.id, token: "token-a", scope: "owner", accounts: [{ id: "bank", name: "Demo bank", currency: "BDT", is_active: true }], categories: [], paymentMethods: [], onClose() {}, onSaved() {} };
  t.after(async () => { if (tree) await act(async () => tree.unmount()); });
  await act(async () => { tree = create(React.createElement(TransactionEditor, props)); });
  await act(async () => input(tree, "Amount").props.onChangeText("14.07"));
  await act(async () => button(tree, "More details").props.onPress());
  await act(async () => input(tree, "Note").props.onChangeText("Exact edited note"));
  const field = input(tree, "Note");
  await act(async () => evidence.resolve([message]));
  const consent = tree.root.findAllByType("Pressable").filter(node => node.props.accessibilityRole === "checkbox").at(-1);
  await act(async () => consent.props.onPress());
  for (const label of ["Original SMS (1)", "Original statement rows (1)"]) {
    assert.equal(button(tree, label).props.accessibilityState.expanded, false);
    await act(async () => button(tree, label).props.onPress());
  }
  const smsBody = tree.root.findAllByType("Text").find(node => node.props.children === message.body);
  assert.equal(smsBody.props.numberOfLines, undefined); assert.equal(smsBody.props.selectable, true);
  assert.equal(button(tree, "Expand original SMS"), undefined, "no nested expansion is needed in an open source section");
  assert(text(tree).includes(source.extracted.raw_text));
  assert.match(text(tree), /Source amount: 12.00 · debit · Reported balance: 0.00/);
  assert(!text(tree).includes("Reviewed description"));
  for (const label of ["Original SMS (1)", "Original statement rows (1)"]) {
    await act(async () => button(tree, label).props.onPress());
    await act(async () => button(tree, label).props.onPress());
  }
  h.resize({ width: 1000, fontScale: 1.8 });
  await act(async () => tree.update(React.createElement(TransactionEditor, { ...props, token: "rotated-token", accounts: [...props.accounts] })));
  assert.equal(input(tree, "Note"), field); assert.equal(field.props.value, "Exact edited note");
  assert.equal(input(tree, "Amount").props.value, "14.07"); assert.equal(consent.props.accessibilityState.checked, true);
  assert.equal(reads, 1); assert.equal(writes, 0);
  await act(async () => button(tree, "Save changes").props.onPress());
  assert.equal(writes, 1); assert.equal(submitted.amount, "14.07"); assert.equal(submitted.note, "Exact edited note");
  assert.equal(submitted.allow_linked_correction, true); assert.equal("extracted" in submitted, false);
});

test("missing original statement extraction never substitutes reviewed values; redaction replaces expanded SMS", async t => {
  let tree; const h = nativeHarness();
  const { StatementSourceEvidence } = h.load("statement-source-evidence"), { SourceMessage } = h.load("mobile-ui");
  t.after(async () => { if (tree) await act(async () => tree.unmount()); });
  await act(async () => { tree = create(React.createElement(StatementSourceEvidence, { source: { ...source, extracted: undefined } })); });
  assert.match(text(tree), /Original extracted statement text is unavailable/);
  assert(!text(tree).includes("Reviewed description")); assert(!text(tree).includes("250.00"));
  await act(async () => tree.update(React.createElement(SourceMessage, { message, fullBody: true })));
  await act(async () => button(tree, "View full SMS").props.onPress());
  await act(async () => tree.update(React.createElement(SourceMessage, { message: { ...message, redacted_at: "2026-10-02T00:00:00Z" }, fullBody: true })));
  assert(!text(tree).includes("Synthetic full original")); assert.match(text(tree), /unavailable or was removed/);
  await act(async () => tree.update(React.createElement(SourceMessage, { message: { ...message, status: "redacted" }, fullBody: true })));
  assert(!text(tree).includes("Synthetic full original"));
});
