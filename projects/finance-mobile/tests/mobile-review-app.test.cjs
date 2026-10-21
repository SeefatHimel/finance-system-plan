const { test } = require("node:test"), assert = require("node:assert/strict");
const { mobileAppHarness } = require("./helpers/mobile-app-harness.cjs");
const { act, input, button, text, deferred } = require("./helpers/native-harness.cjs");
const candidate = (id, extra = {}) => ({ id, status: "needs_review", transaction: null,
  account: "bank", destination_account: null, category: "food", amount: "25.37", balance_after: "102.04",
  reference: `DEMO-${id}`, transaction_type: "expense", message_kind: "card_purchase", provider: "demo",
  confidence: "0.9", counterparty_text: `Synthetic cafe ${id}`, payment_method: null,
  raw_message: { id: `sms-${id}`, sender: "DEMO", body: "Synthetic test fixture", received_at: "2026-10-01T12:34:56Z", status: "parsed" }, ...extra });
const fail = message => Object.assign(new Error(message), { status: 400 });

test("App advances instantly, retains the next edits, restores the failed draft and safely retries rejection", async t => {
  const pending = deferred(), rows = [candidate("a"), candidate("b"), candidate("c")];
  let posts = 0, rejection, reads = 0;
  const h = await mobileAppHarness(t, {
    listMessageCandidates: async () => { reads++; return { count: rows.length, results: [...rows] }; },
    getMessageCandidate: async (_token, id) => rows.find(row => row.id === id),
    confirmMessageCandidate: async () => { posts++; return pending.promise; },
    rejectMessageCandidate: async (_token, id, payload) => {
      rejection = payload;
      if (posts++ === 1) throw fail("Cannot reject this entry yet");
      const row = rows.find(row => row.id === id); row.status = "ignored";
      rows.splice(rows.indexOf(row), 1); return row;
    },
  });
  await h.review();
  await act(async () => button(h.tree, "More details").props.onPress());
  await act(async () => input(h.tree, "Note").props.onChangeText("Exact first draft"));
  await act(async () => input(h.tree, "Reference").props.onChangeText("EDITED-A"));
  const before = { ...h.fields().props.draft };
  await act(async () => button(h.tree, "Confirm & add").props.onPress());
  assert.equal(posts, 1);
  assert.match(text(h.tree), /Message 1 of 2/);
  assert.equal(h.fields().props.draft.reference, "DEMO-b");
  assert.equal(h.fields().props.busy, false, "the next form stays editable");
  assert(button(h.tree, "Save in progress…").props.disabled);
  await act(async () => h.fields().props.onChange({ note: "Newer next draft", amount: "44.19" }));
  await act(async () => pending.reject(fail("Amount: cannot save this value")));
  assert.match(text(h.tree), /Entry and edits restored/);
  assert.equal(h.fields().props.draft.note, "Newer next draft", "rollback does not steal selection");
  await act(async () => button(h.tree, "Review restored message").props.onPress());
  assert.deepEqual(h.fields().props.draft, before);
  // Editing after a definite failure invalidates Retry's old payload.
  await act(async () => h.fields().props.onChange({ note: "Corrected after failure" }));
  assert.equal(button(h.tree, "Retry same decision"), undefined);
  await act(async () => button(h.tree, "Reject message").props.onPress());
  assert.equal(posts, 1, "opening the rejection prompt never writes");
  await act(async () => h.alerts.at(-1)[2].find(choice => choice.text === "Only this message").onPress());
  assert.match(text(h.tree), /Cannot reject/);
  assert.equal(h.fields().props.draft.note, "Newer next draft");
  await act(async () => button(h.tree, "Retry same decision").props.onPress());
  assert.equal(posts, 3); assert.equal(rejection.redact_raw_sms, true);
  assert.equal(rejection.exclude_sender, false);
  assert(reads > 1, "successful rejection refreshes the inbox in the background");
  assert.equal(h.fields().props.draft.note, "Newer next draft");
});

test("App holds both source drafts until explicit transfer acceptance and rolls back a failed link", async t => {
  const pending = deferred();
  const rows = [candidate("a", { transaction_type: "transfer", category: "transfer", destination_account: "wallet" }), candidate("b", { account: "wallet" }), candidate("c")];
  let links = 0;
  const h = await mobileAppHarness(t, {
    listMessageCandidates: async () => ({ count: rows.length, results: rows }),
    getMessageCandidate: async (_token, id) => rows.find(row => row.id === id),
    findTransferMatches: async () => [{ kind: "candidate", id: "b", account: "bank", transfer_account: "wallet", account_name: "Demo bank", transfer_account_name: "Demo wallet", amount: "25.37", date: "2026-10-01", time: null, reason: "Synthetic opposite report", reported_balances: [] }],
    linkTransfer: async () => { links++; return pending.promise; },
  });
  await h.review();
  await act(async () => h.fields().props.onChange({ note: "Transfer first draft" }));
  await act(async () => button(h.tree, "Next message").props.onPress());
  await act(async () => h.fields().props.onChange({ note: "Counterpart draft" }));
  await act(async () => button(h.tree, "Previous message").props.onPress());
  await act(async () => button(h.tree, "Confirm & add").props.onPress());
  assert.match(text(h.tree), /Message 1 of 3/); assert.equal(links, 0);
  await act(async () => h.textButton("Confirm as one transfer").props.onPress());
  assert.equal(links, 1); assert.match(text(h.tree), /Message 1 of 1/);
  assert.equal(h.tree.root.findAllByType("Modal").length, 0);
  await act(async () => pending.reject(fail("Reported balances changed. Review again.")));
  assert.match(text(h.tree), /Reported balances changed/);
  await act(async () => button(h.tree, "Review restored message").props.onPress());
  assert.equal(h.fields().props.draft.note, "Transfer first draft");
  await act(async () => button(h.tree, "Next message").props.onPress());
  assert.equal(h.fields().props.draft.note, "Counterpart draft");
});

test("App ignores a pre-save refresh response and keeps the last pending decision visible", async t => {
  const refresh = deferred(), save = deferred(), row = candidate("a");
  let reads = 0, posts = 0;
  const h = await mobileAppHarness(t, {
    listMessageCandidates: async () => ++reads === 1 ? { count: 1, results: [row] } : refresh.promise,
    getMessageCandidate: async () => row,
    confirmMessageCandidate: async () => { posts++; return save.promise; },
  });
  await h.review();
  await act(async () => { void h.textButton("Refresh inbox").props.onPress(); });
  await act(async () => button(h.tree, "Confirm & add").props.onPress());
  assert.match(text(h.tree), /Review decision pending/); assert.match(text(h.tree), /Saving review decision/);
  await act(async () => refresh.resolve({ count: 1, results: [row] }));
  assert.equal(h.tree.root.findAllByType("TextInput").some(node => node.props.accessibilityLabel === "Amount"), false);
  await act(async () => save.reject(new Error("Connection interrupted")));
  assert.match(text(h.tree), /Save not confirmed/);
  assert(button(h.tree, "Check save status")); assert.equal(posts, 1);
});
