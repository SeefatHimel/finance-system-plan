const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const ts = require("typescript");
const React = require("react");
const { create, act } = require("react-test-renderer");
global.IS_REACT_ACT_ENVIRONMENT = true;
const row = (id, extra = {}) => ({
  id,
  account: "bank",
  transfer_account: null,
  date: "2026-10-01",
  time: null,
  type: "expense",
  amount: "25.00",
  account_direction: "debit",
  category: null,
  note: "",
  counterparty_text: "Demo Cafe",
  source: "web",
  reference: "",
  balance_after: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...extra,
});
function harness(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const requests = [];
  const native = Object.fromEntries(
    [
      "ActivityIndicator",
      "Pressable",
      "ScrollView",
      "Text",
      "TextInput",
      "View",
    ].map((name) => [name, name]),
  );
  native.StyleSheet = { create: (value) => value };
  native.Modal = ({ visible, ...props }) =>
    visible ? React.createElement("Modal", props) : null;
  native.FlatList = (props) =>
    React.createElement(
      "FlatList",
      props,
      props.ListHeaderComponent,
      props.data.length
        ? props.data.map((item, index) =>
            React.createElement(
              React.Fragment,
              { key: props.keyExtractor(item) },
              props.renderItem({ item, index }),
            ),
          )
        : props.ListEmptyComponent,
      props.ListFooterComponent,
    );
  const cache = new Map();
  function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    new Function("module", "exports", "require", code)(
      mod,
      mod.exports,
      (name) => {
        if (name === "react" || name === "react/jsx-runtime")
          return require(name);
        if (name === "react-native") return native;
        if (name === "react-native-safe-area-context")
          return { SafeAreaView: "SafeAreaView" };
        if (name === "./native-time-field")
          return { NativeDateField: "NativeDateField" };
        if (name === "./api")
          return {
            listTransactionActivity: (token, query, offset, signal) =>
              new Promise((resolve, reject) =>
                requests.push({
                  token,
                  query,
                  offset,
                  signal,
                  resolve,
                  reject,
                }),
              ),
          };
        return load(resolve(file, "..", `${name}.ts`));
      },
    );
    return mod.exports;
  }
  const model = load(resolve(__dirname, "../src/activity-model.ts"));
  const { TransactionActivity } = load(
    resolve(__dirname, "../src/transaction-activity.tsx"),
  );
  let props = {
    token: "synthetic-token",
    scope: "demo",
    accounts: [{ id: "bank", name: "Demo bank" }],
    categories: [{ id: "food", name: "Food" }],
    filters: model.initialActivityFilters(),
    cached: [],
    revision: 0,
    pendingCount: 0,
    onQuickAdd() {},
    onFiltersChange(value) {
      props = { ...props, filters: value };
      tree.update(React.createElement(TransactionActivity, props));
    },
  };
  let tree;
  const buttons = () => tree.root.findAllByType("Pressable");
  return {
    model,
    navigation: load(resolve(__dirname, "../src/mobile-navigation.ts")),
    requests,
    async mount() {
      await act(async () => {
        tree = create(React.createElement(TransactionActivity, props));
      });
      await act(async () => t.mock.timers.tick(300));
    },
    async resolve(index, result) {
      await act(async () => requests[index].resolve(result));
    },
    async reject(index, error) {
      await act(async () => requests[index].reject(error));
    },
    async filters(patch) {
      await act(async () =>
        props.onFiltersChange({ ...props.filters, ...patch }),
      );
      await act(async () => t.mock.timers.tick(300));
    },
    async press(label) {
      await act(async () => {
        const button = buttons().find(
          (node) => node.props.accessibilityLabel === label,
        );
        assert(button, `Missing ${label}`);
        button.props.onPress();
      });
    },
    async doublePress(label) {
      await act(async () => {
        const button = buttons().find(
          (node) => node.props.accessibilityLabel === label,
        );
        assert(button);
        button.props.onPress();
        button.props.onPress();
      });
    },
    async chooseText(text) {
      await act(async () => {
        const node = buttons().find((node) =>
          node
            .findAllByType("Text")
            .some((child) => child.props.children === text),
        );
        assert(node, `Missing ${text}`);
        node.props.onPress();
      });
    },
    listRows() {
      return tree.root
        .findAllByType("FlatList")[0]
        .props.data.map((item) => item.id);
    },
    text() {
      return tree.root
        .findAllByType("Text")
        .map((node) =>
          node.children.filter((value) => typeof value === "string").join(""),
        )
        .join(" ");
    },
    async dispose() {
      await act(async () => tree.unmount());
    },
    props() {
      return props;
    },
  };
}
test("activity discards stale filter responses and aborts the previous request", async (t) => {
  const h = harness(t);
  await h.mount();
  await h.filters({ search: "new" });
  assert(h.requests[0].signal.aborted);
  assert.equal(h.requests[1].query.search, "new");
  await h.resolve(1, { count: 1, results: [row("new")], next_offset: null });
  await h.resolve(0, { count: 1, results: [row("old")], next_offset: null });
  assert.deepEqual(h.listRows(), ["new"]);
  await h.dispose();
});
test("activity prevents double paging, deduplicates overlaps, and retains rows on an append failure", async (t) => {
  const h = harness(t);
  await h.mount();
  await h.resolve(0, { count: 3, results: [row("one")], next_offset: 1 });
  await h.doublePress("Load more transactions");
  assert.equal(h.requests.length, 2);
  await h.resolve(1, {
    count: 3,
    results: [row("one"), row("two")],
    next_offset: 2,
  });
  assert.deepEqual(h.listRows(), ["one", "two"]);
  await h.press("Load more transactions");
  await h.reject(2, new Error("Offline"));
  assert.deepEqual(h.listRows(), ["one", "two"]);
  assert(h.text().includes("Offline"));
  await h.press("Load more transactions");
  assert.equal(h.requests[3].offset, 2);
  await h.dispose();
  assert(h.requests[3].signal.aborted);
});
test("details close without losing the timeline, and cancelled filter drafts do not apply", async (t) => {
  const h = harness(t);
  await h.mount();
  await h.resolve(0, { count: 1, results: [row("one")], next_offset: null });
  await h.press("View transaction: Demo Cafe, BDT 25.00, 2026-10-01");
  assert(h.text().includes("Transaction details"));
  await h.press("Close transaction details");
  assert.deepEqual(h.listRows(), ["one"]);
  await h.press("Activity filters");
  await h.chooseText("Daily");
  await h.press("Cancel filters");
  assert.equal(h.props().filters.mode, "all");
  assert.equal(h.requests.length, 1);
  await h.dispose();
});
test("period validation, inclusive bounds, Dhaka grouping and duplicate identity are stable", (t) => {
  const h = harness(t),
    m = h.model,
    initial = m.initialActivityFilters();
  assert.deepEqual(m.activityQuery(initial), {
    search: "",
    account: "",
    category: "",
    type: "",
    ordering: "-date",
  });
  assert.equal(
    m.activityQuery({ ...initial, mode: "daily", start: "2026-10-02" })
      .end_date,
    "2026-10-02",
  );
  assert.equal(
    m.activityQuery({ ...initial, mode: "monthly", start: "2024-02-29" }).month,
    "2024-02",
  );
  assert(
    m.activityDateError({ ...initial, mode: "daily", start: "2026-02-30" }),
  );
  assert(
    m.activityDateError({
      ...initial,
      mode: "custom",
      start: "2026-10-02",
      end: "2026-10-01",
    }),
  );
  assert(
    m.activityDateError({
      ...initial,
      mode: "custom",
      start: "2025-01-01",
      end: "2026-01-02",
    }),
  );
  assert.equal(
    m.activityDateError({
      ...initial,
      mode: "custom",
      start: "2024-01-01",
      end: "2024-12-31",
    }),
    "",
  );
  assert.equal(
    m.activityDay(
      row("one", { created_at: "2026-10-01T20:00:00Z" }),
      "-created_at",
    ),
    "2026-10-02",
  );
});

test("review selection follows identity across reordering and safely advances after removal", (t) => {
  const { navigation: n } = harness(t);
  const rows = [{ id: "first" }, { id: "tapped" }, { id: "last" }];
  assert.equal(n.reviewSelection(rows, "tapped", 0), 1);
  assert.equal(n.reviewSelection([rows[2], rows[0], rows[1]], "tapped", 0), 2);
  assert.equal(n.reviewSelection([rows[0]], "tapped", 2), 0);
  assert.equal(n.reviewSelection([], null, 0), 0);
});

test("changing filters during an append aborts it and prevents stale rows returning", async (t) => {
  const h = harness(t);
  await h.mount();
  await h.resolve(0, { count: 3, results: [row("one")], next_offset: 1 });
  await h.press("Load more transactions");
  await h.filters({ account: "wallet" });
  assert(h.requests[1].signal.aborted);
  await h.resolve(2, {
    count: 1,
    results: [row("wallet", { account: "wallet" })],
    next_offset: null,
  });
  await h.resolve(1, { count: 3, results: [row("stale")], next_offset: null });
  assert.deepEqual(h.listRows(), ["wallet"]);
  await h.dispose();
});
