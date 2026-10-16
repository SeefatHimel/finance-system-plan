const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const ts = require("typescript"),
  React = require("react");
const { create, act } = require("react-test-renderer");
global.IS_REACT_ACT_ENVIRONMENT = true;
function harness(os = "android") {
  let opened;
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
        if (name === "react-native")
          return {
            Platform: { OS: os },
            Pressable: "Pressable",
            Text: "Text",
            View: "View",
            TextInput: "TextInput",
            Modal: "Modal",
          };
        if (name === "@react-native-community/datetimepicker")
          return {
            __esModule: true,
            default: "Picker",
            DateTimePickerAndroid: { open: (options) => (opened = options) },
          };
        return load(resolve(file, "..", `${name}.ts`));
      },
    );
    return mod.exports;
  }
  return {
    fields: load(resolve(__dirname, "../src/native-time-field.tsx")),
    Disclosure: load(resolve(__dirname, "../src/disclosure.tsx")).Disclosure,
    opened: () => opened,
  };
}
test("Android clock seeds reported seconds, uses 24-hour mode and changes nothing on cancel", async () => {
  const h = harness(),
    changes = [];
  let tree;
  await act(async () => {
    tree = create(
      React.createElement(h.fields.NativeTimeField, {
        value: "23:17:42",
        onChange: (value) => changes.push(value),
      }),
    );
  });
  await act(async () => tree.root.findByType("Pressable").props.onPress());
  assert.equal(h.opened().value.getHours(), 23);
  assert.equal(h.opened().value.getMinutes(), 17);
  assert.equal(h.opened().is24Hour, true);
  await act(async () => h.opened().onChange({ type: "dismissed" }, new Date()));
  assert.deepEqual(changes, []);
  const selected = new Date();
  selected.setHours(0, 7, 0, 0);
  await act(async () => h.opened().onChange({ type: "set" }, selected));
  assert.deepEqual(changes, ["00:07"]);
  await act(async () => tree.unmount());
});
test("calendar preserves its date and rejects a rolled-over seed without committing on open or cancel", async () => {
  const h = harness(),
    changes = [];
  let tree;
  const render = (value) =>
    React.createElement(h.fields.NativeDateField, {
      value,
      onChange: (day) => changes.push(day),
    });
  await act(async () => {
    tree = create(render("2024-02-29"));
  });
  await act(async () => tree.root.findByType("Pressable").props.onPress());
  assert.equal(h.opened().value.getMonth(), 1);
  assert.equal(h.opened().value.getDate(), 29);
  await act(async () => h.opened().onChange({ type: "dismissed" }));
  assert.deepEqual(changes, []);
  await act(async () => tree.update(render("2026-02-30")));
  await act(async () => tree.root.findByType("Pressable").props.onPress());
  const now = new Date();
  assert.equal(h.opened().value.getDate(), now.getDate());
  assert.equal(h.opened().value.getMonth(), now.getMonth());
  assert.deepEqual(changes, []);
  await act(async () => tree.unmount());
});
test("iOS clock keeps its draft local until Apply and Cancel does not change the input", async () => {
  const h = harness("ios"),
    changes = [];
  let tree;
  await act(async () => {
    tree = create(
      React.createElement(h.fields.NativeTimeField, {
        value: "07:15",
        onChange: (value) => changes.push(value),
      }),
    );
  });
  await act(async () => tree.root.findByType("Pressable").props.onPress());
  const date = new Date();
  date.setHours(16, 20, 0, 0);
  await act(async () =>
    tree.root.findByType("Picker").props.onChange({ type: "set" }, date),
  );
  assert.deepEqual(changes, []);
  const cancel = tree.root
    .findAllByType("Pressable")
    .find((node) =>
      node
        .findAllByType("Text")
        .some((text) => text.props.children === "Cancel"),
    );
  await act(async () => cancel.props.onPress());
  assert.deepEqual(changes, []);
  assert.equal(tree.root.findByType("TextInput").props.value, "07:15");
  await act(async () => tree.unmount());
});
test("optional fields stay mounted and retain their draft through collapse and expansion", async () => {
  const h = harness();
  let tree,
    mounts = 0;
  function Draft() {
    const [value, setValue] = React.useState("");
    React.useEffect(() => {
      mounts++;
    }, []);
    return React.createElement("TextInput", { value, onChangeText: setValue });
  }
  await act(async () => {
    tree = create(
      React.createElement(
        h.Disclosure,
        { label: "Payment method" },
        React.createElement(Draft),
      ),
    );
  });
  const button = () => tree.root.findByType("Pressable");
  assert.equal(button().props.accessibilityState.expanded, false);
  await act(async () => button().props.onPress());
  await act(async () =>
    tree.root.findByType("TextInput").props.onChangeText("draft"),
  );
  await act(async () => button().props.onPress());
  await act(async () => button().props.onPress());
  assert.equal(tree.root.findByType("TextInput").props.value, "draft");
  assert.equal(mounts, 1);
  await act(async () => tree.unmount());
});

test("a receiving report keeps its exact balance on its own account and cannot move to the sender", () => {
  const code = ts.transpileModule(
    readFileSync(resolve(__dirname, "../src/review-balance.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    },
  ).outputText;
  const mod = { exports: {} };
  new Function("exports", code)(mod.exports);
  const { reviewReportedBalance, updateReviewBalanceContext } = mod.exports;
  const initial = {
    accountId: "",
    balanceAccountId: "",
    direction: "credit",
    type: "income",
  };
  const bound = updateReviewBalanceContext(initial, { accountId: "bank" });
  assert.equal(bound.balanceAccountId, "bank");
  const corrected = updateReviewBalanceContext(bound, {
    type: "transfer",
    direction: "debit",
  });
  assert.equal(corrected.balanceAccountId, "bank");
  const changed = updateReviewBalanceContext(corrected, {
    accountId: "wallet",
  });
  assert.equal(changed.balanceAccountId, "bank");
  assert.equal(
    reviewReportedBalance("0.00", changed.balanceAccountId, changed.accountId),
    null,
  );
  assert.equal(
    reviewReportedBalance("2000.07", "receiving-bank", "receiving-bank"),
    "2000.07",
  );
  assert.equal(
    reviewReportedBalance("2000.07", "receiving-bank", "sending-wallet"),
    null,
  );
  assert.equal(reviewReportedBalance("0.00", "bank", "bank"), "0.00");
  assert.equal(reviewReportedBalance("0.00", "bank", "wallet"), null);
  assert.equal(reviewReportedBalance(null, "bank", "bank"), null);
  assert.equal(reviewReportedBalance("12.34", "", "bank"), "12.34");
  assert.equal(reviewReportedBalance("12.34", "bank", ""), null);
});
