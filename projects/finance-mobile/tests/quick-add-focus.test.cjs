const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { resolve } = require("node:path");
const ts = require("typescript");
const React = require("react");
const { act, create } = require("react-test-renderer");
global.IS_REACT_ACT_ENVIRONMENT = true;

function harness(os = "android") {
  const frames = new Map();
  let nextFrame = 0;
  global.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  global.cancelAnimationFrame = (id) => frames.delete(id);
  const focused = [];
  const preset = {
    id: "preset-demo", name: "Lunch", type: "expense", account: "cash",
    category: null, amount: null, note: "", counterparty_text: "",
    is_enabled: true, is_favorite: true, display_order: 0, available: true,
  };
  let resume;
  const api = {
    listAccounts: async () => [{ id: "cash", name: "Cash", currency: "BDT", is_active: true }],
    listCategories: async () => [],
    listQuickPresets: async () => [preset],
  };
  let dimensions = { width: 390, height: 844, fontScale: 1, scale: 1 };
  const native = {
    Alert: {},
    AppState: { currentState: "active", addEventListener: (_event, callback) => {
      resume = callback;
      return { remove() {} };
    } },
    KeyboardAvoidingView: "KeyboardAvoidingView",
    Modal: ({ visible, ...props }) => visible ? React.createElement("Modal", props) : null,
    Platform: { OS: os },
    useWindowDimensions: () => dimensions,
    Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text",
    TextInput: "TextInput", View: "View", StyleSheet: { create: (value) => value },
  };
  const cache = new Map();
  function load(file) {
    file = resolve(file);
    if (!existsSync(file)) file += existsSync(file + ".tsx") ? ".tsx" : ".ts";
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021,
        jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("module", "exports", "require", code)(mod, mod.exports, (name) => {
      if (name === "react" || name === "react/jsx-runtime") return require(name);
      if (name === "react-native") return native;
      if (name === "@expo/vector-icons") return { MaterialCommunityIcons: "MaterialCommunityIcons" };
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) };
      if (name === "expo-secure-store") return {
        getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {},
      };
      if (name === "./api") return api;
      if (name === "./native-time-field") return { NativeDateField: "NativeDateField", NativeTimeField: "NativeTimeField" };
      return load(resolve(file, "..", name));
    });
    return mod.exports;
  }
  const { QuickAddHub } = load(resolve(__dirname, "../src/quick-add-hub.tsx"));
  const ref = React.createRef();
  const props = { ref, token: "synthetic-token", scope: "synthetic-scope", onFavorites() {},
    onPendingCount() {}, onReferences() {}, onSaved() {}, onFullEntry() {} };
  let tree;
  return {
    focused,
    async mount() {
      await act(async () => { tree = create(React.createElement(QuickAddHub, props), {
        createNodeMock: (element) => element.type === "TextInput"
          ? { focus: () => focused.push(element.props.accessibilityLabel) } : null,
      }); });
    },
    async openEntry() { await act(async () => ref.current.open(preset.id)); },
    async openLauncher() { await act(async () => ref.current.open()); },
    async manage() { await act(async () => ref.current.manage()); },
    async shown() { await act(async () => tree.root.findByType("Modal").props.onShow()); },
    async flushFrames() { await act(async () => {
      const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback());
    }); },
    input(label) { return tree.root.findAllByType("TextInput").find((node) => node.props.accessibilityLabel === label); },
    field(type) { return tree.root.findByType(type); },
    async layout(width, fontScale = 1) { await act(async () => {
      dimensions = { ...dimensions, width, fontScale };
      tree.update(React.createElement(QuickAddHub, props));
      for (const node of tree.root.findAllByType("View").filter(node => node.props.onLayout)) node.props.onLayout({ nativeEvent: { layout: { width } } });
    }); },
    keyboardView() { return tree.root.findByType("KeyboardAvoidingView"); },
    button(label) { return tree.root.findAllByType("Pressable").find((node) =>
      node.props.accessibilityLabel === label || node.findAllByType("Text").some((text) => text.props.children === label)); },
    async press(label) { await act(async () => {
      const button = this.button(label);
      assert.ok(button, `Missing button: ${label}`);
      button.props.onPress();
    }); },
    async type(label, value) { await act(async () => this.input(label).props.onChangeText(value)); },
    async refreshAndRerender() { await act(async () => {
      resume("active");
      tree.update(React.createElement(QuickAddHub, { ...props, token: "refreshed-same-user-token", onReferences() {} }));
    }); },
    async dispose() { await act(async () => tree.unmount()); },
  };
}

test("Android entry waits for its native window, retains the focused input on updates, and cancels closed focus requests", async () => {
  const h = harness();
  await h.mount();
  try {
    await h.openEntry();
    await h.flushFrames();
    assert.deepEqual(h.focused, []);
    assert.equal(h.input("Amount").props.autoFocus, undefined);
    assert.equal(h.keyboardView().props.enabled, false);
    assert.equal(h.keyboardView().props.behavior, undefined);
    await h.shown();
    await h.flushFrames();
    assert.deepEqual(h.focused, ["Amount"]);
    const input = h.input("Amount");
    await h.type("Amount", "125.50");
    await h.refreshAndRerender();
    await h.flushFrames();
    assert.equal(h.input("Amount"), input);
    assert.equal(input.props.value, "125.50");
    assert.deepEqual(h.focused, ["Amount"]);
    await h.press("Close");
    await h.openEntry();
    await h.flushFrames();
    assert.deepEqual(h.focused, ["Amount"]);
    await h.shown();
    await h.press("Close");
    await h.flushFrames();
    assert.deepEqual(h.focused, ["Amount"]);
  } finally { await h.dispose(); }
});

test("preset editor focuses inside an already shown manager without losing typed settings on refresh", async () => {
  const h = harness();
  await h.mount();
  try {
    await h.manage();
    await h.shown();
    await h.press("Create preset");
    await h.flushFrames();
    assert.deepEqual(h.focused, ["Preset name"]);
    const name = h.input("Preset name");
    const note = h.input("Default note");
    await h.type("Preset name", "Morning coffee");
    await h.type("Default note", "Keep my draft");
    await h.refreshAndRerender();
    await h.flushFrames();
    assert.equal(h.input("Preset name"), name);
    assert.equal(h.input("Default note"), note);
    assert.equal(name.props.value, "Morning coffee");
    assert.equal(note.props.value, "Keep my draft");
    assert.deepEqual(h.focused, ["Preset name"]);
    await h.press("Cancel");
    await h.press("Edit Lunch");
    await h.flushFrames();
    assert.deepEqual(h.focused, ["Preset name", "Preset name"]);
  } finally { await h.dispose(); }
});

test("iOS retains padding-based keyboard avoidance and also waits until the modal is shown", async () => {
  const h = harness("ios");
  await h.mount();
  try {
    await h.openEntry();
    assert.equal(h.keyboardView().props.enabled, true);
    assert.equal(h.keyboardView().props.behavior, "padding");
    await h.flushFrames();
    assert.deepEqual(h.focused, []);
    await h.shown();
    await h.flushFrames();
    assert.deepEqual(h.focused, ["Amount"]);
  } finally { await h.dispose(); }
});


test("Quick Add keeps optional fields and exact date/time mounted through collapse, font scaling and refresh", async () => {
  const h = harness();
  await h.mount();
  try {
    await h.openEntry(); await h.shown(); await h.flushFrames();
    await h.type("Amount", "125.50");
    await h.press("More details");
    await h.type("Note", "Keep the optional draft");
    const note = h.input("Note"), amount = h.input("Amount");
    await h.press("More details");
    await h.press("Change date/time");
    const date = h.field("NativeDateField"), time = h.field("NativeTimeField");
    await act(async () => { date.props.onChange("2026-10-02"); time.props.onChange("17:08:29"); });
    await h.press("Change date/time");
    for (const [width, font] of [[280, 1], [580, 1], [900, 1], [900, 2]]) {
      await h.layout(width, font);
      assert.equal(h.input("Amount"), amount); assert.equal(h.input("Note"), note);
      assert.equal(h.field("NativeDateField"), date); assert.equal(h.field("NativeTimeField"), time);
    }
    await h.refreshAndRerender();
    await h.press("More details"); await h.press("Change date/time");
    assert.equal(note.props.value, "Keep the optional draft"); assert.equal(amount.props.value, "125.50");
    assert.equal(date.props.value, "2026-10-02"); assert.equal(time.props.value, "17:08:29");
    assert.deepEqual(h.focused, ["Amount"]);
  } finally { await h.dispose(); }
});

test("Now changes only the time; a selected backdated entry keeps its date", async () => {
  const h = harness();
  await h.mount();
  try {
    await h.openEntry();
    await h.press("Yesterday");
    assert.equal(h.button("Yesterday").props.accessibilityState.selected, true);
    await h.press("Now");
    assert.equal(h.button("Yesterday").props.accessibilityState.selected, true);
    assert.equal(h.button("Now").props.accessibilityState.selected, true);
    await h.press("Income, money in");
    assert.equal(h.button("Income, money in").props.accessibilityState.checked, true);
  } finally { await h.dispose(); }
});

test("choosing an account adds its currency without remounting the amount input", async () => {
  const h = harness();
  await h.mount();
  try {
    await h.openLauncher();
    await h.press("Blank entry");
    const amount = h.input("Amount");
    await h.press("Cash");
    assert.equal(h.input("Amount"), amount);
  } finally { await h.dispose(); }
});
