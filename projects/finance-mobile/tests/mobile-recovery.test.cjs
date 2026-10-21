const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  nativeHarness,
  input,
  button,
  text,
  deferred,
  React,
  create,
  act,
} = require("./helpers/native-harness.cjs");
const action = (id = "demo-action", extra = {}) => ({
  id,
  kind: "create",
  label: "Transaction added",
  transaction: "demo-entry",
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  can_undo: true,
  undone: false,
  ...extra,
});
function recoveryHarness(api) {
  const h = nativeHarness(api);
  const { useTransactionRecovery } = h.load("transaction-recovery");
  let current,
    tree,
    changes = 0;
  function Probe({ scope, token }) {
    current = useTransactionRecovery(token, scope, () => changes++);
    return null;
  }
  return {
    async mount(scope = "owner-a") {
      await act(async () => {
        tree = create(React.createElement(Probe, { scope, token: scope }));
      });
    },
    async owner(scope) {
      await act(async () =>
        tree.update(React.createElement(Probe, { scope, token: scope })),
      );
    },
    get current() {
      return current;
    },
    get changes() {
      return changes;
    },
    async dispose() {
      await act(async () => tree.unmount());
    },
  };
}
test("recent actions from an old owner cannot appear after an account switch", async () => {
  const first = deferred(),
    second = deferred();
  const h = recoveryHarness({
    recentTransactionAction: (token) =>
      token === "owner-a" ? first.promise : second.promise,
  });
  await h.mount();
  await h.owner("owner-b");
  await act(async () => first.resolve(action("old")));
  assert.equal(h.current.latest, null);
  await act(async () => second.resolve(action("new")));
  assert.equal(h.current.latest.id, "new");
  await h.dispose();
});
test("Undo prevents duplicate submissions and revalidates the latest action before writing", async () => {
  const pending = deferred();
  let posts = 0,
    latest = action();
  const h = recoveryHarness({
    recentTransactionAction: async () => latest,
    undoTransactionAction: () => {
      posts++;
      return pending.promise;
    },
  });
  await h.mount();
  await act(async () => {
    void h.current.undo();
    void h.current.undo();
  });
  assert.equal(posts, 1);
  assert.equal(h.current.busy, true);
  latest = { ...latest, undone: true, can_undo: false };
  await act(async () => pending.resolve(latest));
  assert.equal(h.changes, 1);
  assert.equal(h.current.notice, "Action undone.");
  assert.equal(h.current.busy, false);
  await h.dispose();
});
test("a lost Undo response is reconciled through a read, without sending the mutation twice", async () => {
  let latest = action(),
    posts = 0;
  const h = recoveryHarness({
    recentTransactionAction: async () => latest,
    undoTransactionAction: async () => {
      posts++;
      latest = { ...latest, undone: true, can_undo: false };
      throw new Error("Synthetic network interruption");
    },
  });
  await h.mount();
  await act(async () => h.current.undo());
  assert.equal(posts, 1);
  assert.equal(h.changes, 1);
  assert.equal(h.current.notice, "Action undone.");
  await h.dispose();
});
test("newer work disables stale Undo and expired actions never issue a mutation", async () => {
  let latest = action(),
    posts = 0;
  const h = recoveryHarness({
    recentTransactionAction: async () => latest,
    undoTransactionAction: async () => {
      posts++;
    },
  });
  await h.mount();
  latest = action("newer");
  await act(async () => h.current.undo());
  assert.equal(posts, 0);
  assert.equal(h.current.latest.id, "newer");
  assert.match(h.current.error, /no longer available/);
  latest = action("expired", {
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  await act(async () => h.current.refresh());
  await act(async () => h.current.undo());
  assert.equal(posts, 0);
  await h.dispose();
});
test("an old user's completed Undo cannot notify or refresh the new user's ledger", async () => {
  const pending = deferred();
  let latest = action();
  const h = recoveryHarness({
    recentTransactionAction: async (token) =>
      token === "owner-a" ? latest : null,
    undoTransactionAction: () => pending.promise,
  });
  await h.mount();
  await act(async () => {
    void h.current.undo();
  });
  await h.owner("owner-b");
  await act(async () => pending.resolve({ ...latest, undone: true }));
  assert.equal(h.changes, 0);
  assert.equal(h.current.notice, "");
  assert.equal(h.current.latest, null);
  await h.dispose();
});
const row = {
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
  counterparty_text: "Demo Cafe",
  note: "",
  needs_review: false,
  balance_after: "0.00",
  transfer_evidence: [],
  updated_at: "2026-10-01T01:00:00Z",
  source: "sms",
};
test("editing loads the saved UUID, keeps typed fields through token refresh and does not wait for slow source evidence", async () => {
  const evidence = deferred();
  let loads = 0,
    tree;
  const h = nativeHarness({
    getTransaction: async () => {
      loads++;
      return row;
    },
    getTransactionSourceMessages: () => evidence.promise,
    getTransactionStatements: async () => [],
  });
  const { TransactionEditor } = h.load("transaction-editor");
  const props = {
    id: row.id,
    token: "token-a",
    scope: "owner-a",
    accounts: [
      { id: "bank", name: "Demo bank", currency: "BDT", is_active: true },
    ],
    categories: [],
    paymentMethods: [],
    onClose() {},
    onSaved() {},
  };
  await act(async () => {
    tree = create(React.createElement(TransactionEditor, props));
  });
  const field = input(tree, "Note");
  assert.ok(field);
  await act(async () => field.props.onChangeText("Keep this draft"));
  await act(async () =>
    tree.update(
      React.createElement(TransactionEditor, {
        ...props,
        token: "token-refreshed",
        accounts: [...props.accounts],
      }),
    ),
  );
  assert.equal(input(tree, "Note"), field);
  assert.equal(field.props.value, "Keep this draft");
  assert.equal(loads, 1);
  assert.equal(
    input(tree, "Reported balance after · Demo bank").props.value,
    "0.00",
  );
  await act(async () => evidence.resolve([]));
  assert.equal(field.props.value, "Keep this draft");
  await act(async () => tree.unmount());
});
test("a newer saved version blocks an edit instead of overwriting it, retaining the typed correction", async () => {
  let loads = 0,
    writes = 0,
    tree;
  const h = nativeHarness({
    getTransaction: async () =>
      ++loads === 1 ? row : { ...row, updated_at: "2026-10-02T01:00:00Z" },
    getTransactionSourceMessages: async () => [],
    getTransactionStatements: async () => [],
    updateTransaction: async () => {
      writes++;
      return row;
    },
  });
  const { TransactionEditor } = h.load("transaction-editor");
  await act(async () => {
    tree = create(
      React.createElement(TransactionEditor, {
        id: row.id,
        scope: "owner",
        token: "token",
        accounts: [
          { id: "bank", name: "Demo bank", is_active: true, currency: "BDT" },
        ],
        categories: [],
        paymentMethods: [],
        onClose() {},
        onSaved() {},
      }),
    );
  });
  await act(async () =>
    input(tree, "Note").props.onChangeText("Retain correction"),
  );
  await act(async () => button(tree, "Save changes").props.onPress());
  assert.equal(writes, 0);
  assert.match(text(tree), /changed since you opened/);
  assert.equal(input(tree, "Note").props.value, "Retain correction");
  await act(async () => tree.unmount());
});
test("saving twice sends only one PATCH and an owner change during preflight prevents any write", async () => {
  const preflight = deferred();
  let loads = 0,
    writes = 0,
    saved = 0,
    current = true,
    tree;
  const h = nativeHarness({
    getTransaction: async () => (++loads === 1 ? row : preflight.promise),
    getTransactionSourceMessages: async () => [],
    getTransactionStatements: async () => [],
    updateTransaction: async () => {
      writes++;
      return row;
    },
  });
  const { TransactionEditor } = h.load("transaction-editor");
  await act(async () => {
    tree = create(
      React.createElement(TransactionEditor, {
        id: row.id,
        scope: "owner",
        token: "token",
        accounts: [
          { id: "bank", name: "Demo bank", currency: "BDT", is_active: true },
        ],
        categories: [],
        paymentMethods: [],
        isCurrent: () => current,
        onClose() {},
        onSaved() {
          saved++;
        },
      }),
    );
  });
  await act(async () => input(tree, "Note").props.onChangeText("Changed"));
  const save = button(tree, "Save changes").props.onPress;
  await act(async () => {
    save();
    save();
  });
  assert.equal(loads, 2);
  current = false;
  await act(async () => preflight.resolve(row));
  assert.equal(writes, 0);
  assert.equal(saved, 0);
  await act(async () => tree.unmount());
});

test("linked statement corrections wait for source evidence and require explicit acknowledgement", async () => {
  const evidence = deferred();
  let tree,
    writes = 0;
  const linked = { ...row, statement_evidence_count: 1 };
  const h = nativeHarness({
    getTransaction: async () => linked,
    getTransactionSourceMessages: () => evidence.promise,
    getTransactionStatements: async () => [],
    updateTransaction: async (_token, _id, patch) => {
      writes++;
      assert.equal(patch.allow_linked_correction, true);
      assert.equal(patch.amount, "150.07");
      assert.equal("balance_after" in patch, false);
      return linked;
    },
  });
  const { TransactionEditor } = h.load("transaction-editor");
  await act(async () => {
    tree = create(
      React.createElement(TransactionEditor, {
        id: row.id,
        scope: "owner",
        token: "token",
        accounts: [
          { id: "bank", name: "Demo bank", currency: "BDT", is_active: true },
        ],
        categories: [],
        paymentMethods: [],
        onClose() {},
        onSaved() {},
      }),
    );
  });
  await act(async () => input(tree, "Amount").props.onChangeText("150.07"));
  await act(async () => button(tree, "Save changes").props.onPress());
  assert.equal(writes, 0);
  assert.match(text(tree), /Wait for linked source evidence/);
  await act(async () => evidence.resolve([]));
  await act(async () => button(tree, "Save changes").props.onPress());
  assert.equal(writes, 0);
  assert.match(text(tree), /confirm the correction/);
  const ack = tree.root
    .findAllByType("Pressable")
    .find(
      (node) =>
        node.props.accessibilityRole === "checkbox" &&
        node.props.children?.props?.children?.includes?.(
          " I reviewed the sources and confirm this correction",
        ),
    );
  // Choose the acknowledgement independently of the optional Needs review checkbox.
  const confirmation =
    ack ??
    tree.root
      .findAllByType("Pressable")
      .filter((node) => node.props.accessibilityRole === "checkbox")
      .at(-1);
  await act(async () => confirmation.props.onPress());
  await act(async () => button(tree, "Save changes").props.onPress());
  assert.equal(writes, 1);
  await act(async () => tree.unmount());
});

test("server sync status ignores old owners and preserves the last known report on a refresh failure", async () => {
  const old = deferred();
  let value,
    tree,
    fail = false,
    calls = 0;
  const h = nativeHarness({
    getSmsDeviceStatus: () => {
      calls++;
      return calls === 1
        ? old.promise
        : fail
          ? Promise.reject(new Error("Offline"))
          : Promise.resolve({
              last_successful_sync_at: "2026-10-17T01:00:00Z",
            });
    },
  });
  const { useServerSyncStatus } = h.load("sync-summary");
  function Probe(props) {
    value = useServerSyncStatus(props.token, props.scope, props.completion);
    return null;
  }
  await act(async () => {
    tree = create(
      React.createElement(Probe, {
        token: "a",
        scope: "a",
        completion: "idle",
      }),
    );
  });
  await act(async () =>
    tree.update(
      React.createElement(Probe, {
        token: "b",
        scope: "b",
        completion: "idle",
      }),
    ),
  );
  await act(async () =>
    old.resolve({ last_successful_sync_at: "2000-01-01T00:00:00Z" }),
  );
  assert.equal(value.scope, "b");
  assert.equal(value.value.last_successful_sync_at, "2026-10-17T01:00:00Z");
  fail = true;
  await act(async () => h.resume());
  assert.equal(value.error, true);
  assert.equal(value.value.last_successful_sync_at, "2026-10-17T01:00:00Z");
  await act(async () => tree.unmount());
});

test("hardware Back and Cancel preserve dirty editor fields until explicit discard", async () => {
  let tree, closes = 0, choices;
  const h = nativeHarness({
    getTransaction: async () => row,
    getTransactionSourceMessages: async () => [],
    getTransactionStatements: async () => [],
  });
  h.native.Alert = { alert(_title, _message, buttons) { choices = buttons; } };
  const { TransactionEditor } = h.load("transaction-editor");
  await act(async () => { tree = create(React.createElement(TransactionEditor, {
    id: row.id, token: "demo-token", scope: "demo-owner",
    accounts: [{ id: "bank", name: "Demo bank", currency: "BDT", is_active: true }],
    categories: [], paymentMethods: [], onClose() { closes++; }, onSaved() {},
  })); });
  const note = input(tree, "Note");
  await act(async () => note.props.onChangeText("Retain until I discard"));
  await act(async () => tree.root.findByType("Modal").props.onRequestClose());
  assert.equal(closes, 0);
  assert.equal(choices[0].text, "Keep editing");
  assert.equal(input(tree, "Note"), note);
  assert.equal(note.props.value, "Retain until I discard");
  await act(async () => button(tree, "Cancel editing").props.onPress());
  assert.equal(closes, 0);
  await act(async () => choices.find(item => item.text === "Discard changes").onPress());
  assert.equal(closes, 1);
  await act(async () => tree.unmount());
});
