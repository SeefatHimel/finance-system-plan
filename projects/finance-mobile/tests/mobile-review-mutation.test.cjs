const { test } = require("node:test"), assert = require("node:assert/strict");
const { nativeHarness, React, create, act, deferred, text, button } = require("./helpers/native-harness.cjs");
const candidate = (id, extra = {}) => ({ id, status: "needs_review", transaction: null,
  account: "bank", amount: "25.37", balance_after: "102.04", reference: "DEMO-REFERENCE", transaction_type: "expense", ...extra });
const draft = id => ({ accountId: "bank", balanceAccountId: "bank", balanceAfter: "102.04", balanceNotice: "", amount: "25.37",
  direction: "debit", categoryId: "food", counterpartyText: "Synthetic cafe", date: "2026-10-01", time: "12:34:56",
  note: `Edited ${id}`, reference: "DEMO-REFERENCE", paymentMethodId: "demo-card", transferAccountId: "", transactionType: "expense" });
const decision = (id = "a") => ({ kind: "confirm", candidate: id, input: { account: "bank", amount: "25.37", balance_after: "102.04", time: "12:34:56", type: "expense", note: "Edited a" } });
const fail = (status, message = "Amount is invalid") => Object.assign(new Error(message), { status });

function harness(api = {}, options = {}) {
  let current, tree, scope = "owner-a", token = "token-a", begun = [], settled = 0;
  let rows = [candidate("a"), candidate("b"), candidate("c")];
  let drafts = Object.fromEntries(rows.map(row => [row.id, draft(row.id)]));
  const calls = [], resolutions = [];
  const state = new Map(rows.map(row => [row.id, row]));
  const transport = {
    getMessageCandidate: async (token, id) => { calls.push(["get", token, id]); return api.get ? api.get(id) : state.get(id); },
    confirmMessageCandidate: async (token, id, input) => { calls.push(["confirm", token, id, input]); return api.confirm ? api.confirm(id, input) : candidate(id, { status: "confirmed", transaction: `saved-${id}` }); },
    rejectMessageCandidate: async (token, id, input) => { calls.push(["reject", token, id, input]); return api.reject ? api.reject(id, input) : candidate(id, { status: "ignored" }); },
    linkTransfer: async (token, input, match, balances) => { calls.push(["link", token, input, match, balances]); return api.link ? api.link(input, match, balances) : { id: "saved-transfer" }; },
  };
  const native = nativeHarness(transport);
  const { useReviewMutation, reviewSnapshots, restoreReviewRows } = native.load("review-mutation");
  const { ReviewSaveNotice } = native.load("review-save-notice");
  function Probe() {
    current = useReviewMutation({ scope, token,
      onBegin: ids => { begun.push(ids); },
      onRestore: snapshots => { rows = restoreReviewRows(rows, snapshots); drafts = { ...drafts, ...Object.fromEntries(snapshots.map(item => [item.candidate.id, item.draft])) }; },
      onSettled: () => { settled++; },
      onResolved: result => { resolutions.push(result); options.resolved?.(result); },
    });
    return React.createElement(ReviewSaveNotice, { review: current, candidates: current.visible(rows), onReview: options.onReview || (() => {}), onEdit() {} });
  }
  return {
    calls, resolutions, state, get current() { return current; }, get drafts() { return drafts; }, get begun() { return begun; }, get settled() { return settled; }, get tree() { return tree; },
    get visible() { return current.visible(rows).map(row => row.id); }, get count() { return current.count(rows.length); },
    async mount() { await act(async () => { tree = create(React.createElement(Probe)); }); },
    async start(input = decision()) {
      await act(async () => { await current.start(input, reviewSnapshots(rows, input.kind === "link" && input.match.kind === "candidate" ? [input.input.candidate, input.match.id] : [input.candidate ?? input.input.candidate], row => drafts[row.id])); });
    },
    async begin(input = decision()) {
      let promise;
      await act(async () => { promise = current.start(input, reviewSnapshots(rows, input.kind === "link" && input.match.kind === "candidate" ? [input.input.candidate, input.match.id] : [input.candidate ?? input.input.candidate], row => drafts[row.id])); });
      return { promise };
    },
    async finish(promise) { await act(async () => { await promise; }); },
    async owner(value) { scope = value; token = value; await act(async () => tree.update(React.createElement(Probe))); },
    async rotate(value) { token = value; await act(async () => tree.update(React.createElement(Probe))); },
    async replaceRows(value) { rows = value; await act(async () => tree.update(React.createElement(Probe))); },
    async edit(id, patch) { drafts = { ...drafts, [id]: { ...drafts[id], ...patch } }; await act(async () => tree.update(React.createElement(Probe))); },
    async press(label) { await act(async () => button(tree, label).props.onPress()); },
    async dispose() { await act(async () => tree.unmount()); },
  };
}

test("approval removes a row and count before the write finishes, blocking stale reads and double taps", async t => {
  const write = deferred(), h = harness({ confirm: () => write.promise }); await h.mount(); t.after(() => h.dispose());
  const marker = h.current.refreshMarker();
  const { promise } = await h.begin();
  assert.deepEqual(h.visible, ["b", "c"]); assert.equal(h.count, 2);
  assert.equal(h.current.busy, true); assert.equal(h.current.paginationDirty, true);
  assert.equal(h.current.acceptRefresh(marker), false);
  assert.match(text(h.tree), /Saving review decision/);
  await h.begin();
  assert.equal(h.calls.filter(row => row[0] === "confirm").length, 1);
  assert.equal(h.current.visible([candidate("a"), candidate("b")]).length, 1);
  await act(async () => write.resolve(candidate("a", { status: "confirmed", transaction: "saved-a" })));
  await h.finish(promise);
  assert.deepEqual(h.visible, ["b", "c"]); assert.equal(h.resolutions.length, 1);
  assert.equal(h.current.operation.resultTransaction, "saved-a");
  const fresh = h.current.refreshMarker();
  await h.replaceRows([candidate("b"), candidate("c")]);
  await act(async () => assert(h.current.acceptRefresh(fresh)));
  assert.equal(h.current.paginationDirty, false); assert.equal(h.count, 2);
  await h.replaceRows([candidate("a"), candidate("b"), candidate("c")]);
  assert.deepEqual(h.visible, ["a", "b", "c"], "a later authoritative Undo may reopen the same ID");
});

test("validation failure restores the exact edited row in place without rolling back the next draft", async t => {
  const write = deferred(), h = harness({ confirm: () => write.promise }); await h.mount(); t.after(() => h.dispose());
  const before = { ...h.drafts.a };
  const { promise } = await h.begin();
  await h.edit("b", { note: "Newer next-item edit", amount: "44.19" });
  await h.replaceRows([candidate("b"), candidate("c")]);
  await act(async () => write.reject(fail(400, "Amount: choose a positive amount")));
  await h.finish(promise);
  assert.deepEqual(h.visible, ["a", "b", "c"]);
  assert.deepEqual(h.drafts.a, before);
  assert.equal(h.drafts.b.note, "Newer next-item edit"); assert.equal(h.drafts.b.amount, "44.19");
  assert.equal(h.current.blocked, false);
  assert.match(text(h.tree), /Entry and edits restored/); assert.match(text(h.tree), /positive amount/);
});

test("lost response after a committed write is reconciled by GET without a second mutation", async t => {
  let read = 0;
  const h = harness({ get: id => ++read === 1 ? candidate(id) : candidate(id, { status: "confirmed", transaction: "saved-on-server" }), confirm: () => { throw new Error("Connection lost"); } });
  await h.mount(); t.after(() => h.dispose()); await h.start();
  assert.deepEqual(h.visible, ["b", "c"]);
  assert.equal(h.calls.filter(row => row[0] === "confirm").length, 1);
  assert.equal(h.resolutions[0].observed, true);
  assert.equal(h.current.operation.resultTransaction, "saved-on-server");
});

test("unknown outcomes remain hidden; Check never writes and explicit retry keeps exact payload with the latest token", async t => {
  let writes = 0;
  const h = harness({ confirm: id => { if (++writes === 1) throw new Error("Response lost"); return candidate(id, { status: "confirmed", transaction: "saved-a" }); } });
  await h.mount(); t.after(() => h.dispose());
  const action = decision(); await h.start(action);
  action.input.amount = "999.00"; action.input.note = "Mutated external object";
  assert.equal(h.current.operation.phase, "unknown"); assert.equal(h.current.blocked, true);
  await h.start(decision("b")); assert.equal(writes, 1);
  await h.press("Check save status"); assert.equal(writes, 1); assert.deepEqual(h.visible, ["b", "c"]);
  await h.rotate("rotated-token");
  await h.press("Retry same decision");
  const calls = h.calls.filter(row => row[0] === "confirm");
  assert.equal(calls.length, 2); assert.equal(calls[1][1], "rotated-token");
  assert.deepEqual(calls[0][3], calls[1][3]); assert.equal(calls[1][3].amount, "25.37");
  assert.equal(h.current.operation.phase, "resolved");
});

test("failed status preflight restores without writing; an uncertain retry with unreadable status cannot write", async t => {
  let offline = true;
  const h = harness({ get: id => { if (offline) throw new Error("Offline"); return candidate(id); }, confirm: () => { throw new Error("Lost response"); } });
  await h.mount(); t.after(() => h.dispose()); await h.start();
  assert.equal(h.current.operation.phase, "failed"); assert.deepEqual(h.visible, ["a", "b", "c"]);
  assert.equal(h.calls.filter(row => row[0] === "confirm").length, 0);
  await h.press("Retry same decision"); assert.equal(h.current.operation.phase, "failed");
  offline = false; await h.press("Retry same decision"); assert.equal(h.current.operation.phase, "unknown");
  offline = true; await h.press("Retry same decision");
  assert.equal(h.current.operation.phase, "unknown");
  assert.equal(h.calls.filter(row => row[0] === "confirm").length, 1);
});

test("transfer linking hides both candidates and restores both drafts after a rejected balance choice", async t => {
  const write = deferred(), h = harness({ link: () => write.promise }); await h.mount(); t.after(() => h.dispose());
  const before = JSON.parse(JSON.stringify(h.drafts));
  const action = { kind: "link", input: { candidate: "a", draft: { type: "transfer", amount: "25.37" } }, match: { kind: "candidate", id: "b" }, balances: [{ account: "bank", keep: "incoming", existing_balance_after: "100.00", incoming_balance_after: "102.04" }] };
  const { promise } = await h.begin(action);
  assert.deepEqual(h.visible, ["c"]); assert.equal(h.count, 1);
  await act(async () => write.reject(fail(400, "Reported balances changed. Review again."))); await h.finish(promise);
  assert.deepEqual(h.visible, ["a", "b", "c"]); assert.deepEqual(h.drafts, before);
  assert.match(text(h.tree), /Reported balances changed/);
});

test("a counterpart reviewed elsewhere never causes a new link or consumes the still-pending source", async t => {
  const h = harness({ get: id => id === "b" ? candidate(id, { status: "confirmed", transaction: "other-record" }) : candidate(id) });
  await h.mount(); t.after(() => h.dispose());
  await h.start({ kind: "link", input: { candidate: "a", draft: { type: "transfer" } }, match: { kind: "candidate", id: "b" }, balances: [] });
  assert.equal(h.calls.filter(row => row[0] === "link").length, 0);
  assert.deepEqual(h.visible, ["a", "c"]); assert.equal(h.current.operation.phase, "failed");
});

test("rejection remains immediate and its lost receipt is reconciled as ignored", async t => {
  let read = 0;
  const h = harness({ get: id => ++read === 1 ? candidate(id) : candidate(id, { status: "ignored" }), reject: () => { throw new Error("Timed out"); } });
  await h.mount(); t.after(() => h.dispose());
  await h.start({ kind: "reject", candidate: "a", input: { reason: "not_transaction", exclude_provider: true, redact_raw_sms: true } });
  assert.equal(h.calls.filter(row => row[0] === "reject").length, 1);
  assert.deepEqual(h.visible, ["b", "c"]); assert.equal(h.resolutions[0].decision.input.exclude_provider, true);
});

test("logout during preflight prevents the write, and an old save cannot change a new session", async t => {
  const lookup = deferred(), h = harness({ get: () => lookup.promise }); await h.mount(); t.after(() => h.dispose());
  const { promise } = await h.begin(); await h.owner(null); await h.owner("owner-b");
  await act(async () => lookup.resolve(candidate("a"))); await h.finish(promise);
  assert.equal(h.calls.filter(row => row[0] === "confirm").length, 0); assert.equal(h.resolutions.length, 0);
  assert.deepEqual(h.visible, ["a", "b", "c"]);
});

test("a reporting callback failure cannot roll back a successful financial write", async t => {
  const h = harness({}, { resolved: () => { throw new Error("Refresh failed"); } });
  await h.mount(); t.after(() => h.dispose()); await h.start();
  assert.equal(h.current.operation.phase, "resolved"); assert.deepEqual(h.visible, ["b", "c"]);
  assert.equal(h.calls.filter(row => row[0] === "confirm").length, 1);
});

test("gateway failures and malformed receipts remain uncertain while the candidate is pending", async t => {
  for (const receipt of [() => { throw fail(502, "Gateway response lost"); }, () => ({ id: "wrong-receipt" })]) {
    const h = harness({ confirm: receipt }); await h.mount();
    try {
      await h.start();
      assert.equal(h.current.operation.phase, "unknown"); assert.deepEqual(h.visible, ["b", "c"]);
      assert.equal(h.calls.filter(row => row[0] === "confirm").length, 1);
      const marker = h.current.refreshMarker();
      await act(async () => h.current.acceptRefresh(marker));
      assert.equal(h.current.paginationDirty, true, "a pending status cannot authorize shifted offset pagination");
    } finally { await h.dispose(); }
  }
});

test("an old session's late POST cannot resolve or unlock the new session's in-flight save", async t => {
  const first = deferred(), second = deferred(); let writes = 0;
  const h = harness({ confirm: () => ++writes === 1 ? first.promise : second.promise });
  await h.mount(); t.after(() => h.dispose());
  const old = await h.begin(); await h.owner(null); await h.owner("owner-a");
  const next = await h.begin(decision("b"));
  await act(async () => first.resolve(candidate("a", { status: "confirmed", transaction: "old-result" })));
  await h.finish(old.promise);
  assert.equal(h.current.operation.phase, "saving"); assert.equal(h.resolutions.length, 0);
  await h.begin(decision("c")); assert.equal(writes, 2);
  await act(async () => second.resolve(candidate("b", { status: "confirmed", transaction: "new-result" })));
  await h.finish(next.promise);
  assert.equal(h.resolutions.length, 1); assert.equal(h.current.operation.resultTransaction, "new-result");
});

test("a failed link retry reuses its captured target and balance choices and rechecks both sources", async t => {
  let writes = 0;
  const h = harness({ link: () => { if (++writes === 1) throw fail(400); return { id: "saved-transfer" }; } });
  await h.mount(); t.after(() => h.dispose());
  const action = { kind: "link", input: { candidate: "a", draft: { type: "transfer", amount: "25.37" } }, match: { kind: "candidate", id: "b" }, balances: [{ account: "bank", keep: "incoming", existing_balance_after: "100.00", incoming_balance_after: "102.04" }] };
  await h.start(action); action.match.id = "c"; action.balances[0].keep = "existing";
  await h.press("Retry same decision");
  const calls = h.calls.filter(row => row[0] === "link");
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  assert.equal(h.calls.filter(row => row[0] === "get").length, 6);
});

test("linking a pending source outside the loaded window immediately decrements both from the total", async t => {
  const pending = deferred(), h = harness({ get: id => candidate(id), link: () => pending.promise });
  await h.mount(); t.after(() => h.dispose());
  const { promise } = await h.begin({ kind: "link", input: { candidate: "a", draft: { type: "transfer" } }, match: { kind: "candidate", id: "off-page" }, balances: [] });
  assert.equal(h.current.count(103), 101);
  assert.deepEqual(h.visible, ["b", "c"]);
  assert.equal(h.current.acceptRefresh(h.current.refreshMarker()), false, "do not partly replace the count baseline while saving");
  await act(async () => pending.resolve({ id: "saved-transfer" })); await h.finish(promise);
  const marker = h.current.refreshMarker();
  await act(async () => assert.equal(h.current.acceptRefresh(marker), true));
  assert.equal(h.current.count(101), 101, "the settled server count already excludes both sources");
});
