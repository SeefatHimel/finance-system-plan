const { test } = require("node:test"), assert = require("node:assert/strict");
const { nativeHarness, React, create, act, input, button } = require("./helpers/native-harness.cjs");
const query = require("@tanstack/react-query");
query.notifyManager.setScheduler(callback => queueMicrotask(callback));

test("app wiring restores Activity and manual edits without bootstrapping APIs on Back or JWT refresh", async t => {
  const core = await import("@react-navigation/core");
  let tree, recovery, activityReads = 0, reviewReads = 0;
  const errors = [];
  t.mock.method(console, "error", (...args) => { if (!String(args[0]).includes("react-test-renderer is deprecated")) errors.push(args.join(" ")); });
  global.__DEV__ = false;
  global.requestAnimationFrame = callback => setTimeout(callback, 0);
  global.cancelAnimationFrame = clearTimeout;
  const token = suffix => `header.${Buffer.from(JSON.stringify({ user_id: "synthetic-owner", suffix })).toString("base64url")}.signature`;
  let session = { username: "demo", access: token("first"), refresh: "synthetic-refresh" };
  const account = { id: "bank", name: "Demo bank", type: "bank", currency: "BDT", current_balance: "100.00", opening_balance: "0.00", is_active: true };
  const page = { count: 0, next_offset: null, results: [] };
  const api = {
    getApiBaseUrl: () => "https://synthetic.invalid",
    checkHealth: async () => ({ ok: true }),
    configureAuthenticationRecovery: callback => { recovery = callback; },
    getCurrentUser: async () => ({ id: "synthetic-owner", username: "demo" }),
    listAccounts: async () => [account], listCategories: async () => [], listPaymentMethods: async () => [], listSenderRules: async () => [],
    listTransactionActivity: async () => { activityReads++; return page; },
    listMessageCandidates: async () => { reviewReads++; return { count: 0, results: [] }; },
    getSmsCapturePreference: async () => ({ excluded_providers: [], excluded_message_kinds: [], raw_sms_retention_days: null }),
    getSmsDeviceStatus: async () => null, recentTransactionAction: async () => null,
    listDebts: async () => [],
    refreshLogin: async () => ({ access: token("rotated"), refresh: "synthetic-refresh-rotated" }),
    logout: async () => {}, login: async () => ({ access: token("new-login"), refresh: "synthetic-new-refresh" }),
    AuthenticationError: class AuthenticationError extends Error {},
  };
  const QuickAdd = React.forwardRef(function QuickAdd(_props, ref) {
    React.useImperativeHandle(ref, () => ({ open() {}, manage() {} })); return null;
  });
  const Icon = Object.assign(() => null, { font: {}, glyphMap: {} });
  const h = nativeHarness(api, "android", {
    "./src/api": api,
    "@react-navigation/native": { ...core, NavigationContainer: core.BaseNavigationContainer },
    "@tanstack/react-query": query,
    "expo-status-bar": { StatusBar: () => null }, "expo-font": { useFonts: () => [true] },
    "@expo/vector-icons/MaterialCommunityIcons": { default: Icon },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView", SafeAreaProvider: ({ children }) => children },
    "@react-native-async-storage/async-storage": { default: { getItem: async () => null, setItem: async () => {}, multiRemove: async () => {}, removeItem: async () => {} } },
    "./src/session": { loadSession: async () => session, saveSession: async value => { session = value; }, clearSession: async () => { session = null; } },
    "./src/secure-sms-queue": { loadSecureSmsQueue: async () => "[]", saveSecureSmsQueue: async () => {} },
    "./src/quick-add-hub": { QuickAddHub: QuickAdd },
    "./src/theme-preference": { loadThemePreference: async () => "system", saveThemePreference: async () => {} },
    "./modules/finance-sms-capture/src": {
      isNativeSmsCaptureAvailable: () => false,
      getNativeSmsBackgroundSyncStatus: async () => null,
      getNativeSmsBackgroundSyncSession: async () => null,
      initializeNativeSmsSession: async () => {}, getCapturedSmsMessages: async () => [],
    },
  });
  Object.assign(h.native, {
    useColorScheme: () => "dark", Appearance: { setColorScheme() {} }, Keyboard: { dismiss() {} },
    Animated: { Value: class { setValue() {} }, timing: () => ({ start: callback => callback?.({ finished: true }) }), View: "AnimatedView" },
    Easing: { out: () => {}, in: () => {}, cubic() {} },
  });
  h.native.AppState.currentState = "active";
  h.native.StyleSheet.flatten = value => Array.isArray(value) ? Object.assign({}, ...value) : value;
  const { default: App } = h.load("../App");
  t.after(async () => { if (tree) await act(async () => tree.unmount()); });
  await act(async () => { tree = create(React.createElement(App)); });
  const { RetainedNavigation } = h.load("retained-navigation");
  const nav = tree.root.findByType(RetainedNavigation).props.navigation;
  const tab = name => tree.root.findAllByType("Pressable").find(node => node.props.accessibilityRole === "tab" && node.findAllByType("Text").some(text => text.props.children === name));
  await act(async () => tab("Activity").props.onPress());
  const list = tree.root.findAllByType("FlatList")[0];
  const reads = activityReads, reviews = reviewReads;
  await act(async () => tab("More").props.onPress());
  assert.equal(button(tree, "Open menu"), undefined, "secondary destinations have one entry point");
  assert(tree.root.findAllByType("Text").some(node => node.props.accessibilityRole === "header" && node.props.children === "More"));
  await act(async () => button(tree, "Accounts").props.onPress());
  assert(tree.root.findAllByType("Text").some(node => node.props.accessibilityRole === "header" && node.props.children === "Accounts"));
  await act(async () => button(tree, "Go back").props.onPress());
  assert.equal(nav.getCurrentRoute().name, "more");
  await act(async () => nav.goBack());
  assert.equal(nav.getCurrentRoute().name, "activity");
  assert.equal(tree.root.findAllByType("FlatList")[0], list);
  assert.equal(activityReads, reads);
  assert.equal(reviewReads, reviews);
  await act(async () => tree.root.findByType(QuickAdd).props.onFullEntry({ account: "bank", category: "", type: "expense", amount: "12.34", note: "Transferred draft", counterparty_text: "", dateMode: "today", timeMode: "none" }));
  await act(async () => button(tree, "More details").props.onPress());
  const field = input(tree, "Note");
  await act(async () => field.props.onChangeText("Keep these exact edits"));
  await act(async () => button(tree, "Back to Finance").props.onPress());
  assert.equal(nav.getCurrentRoute().name, "activity");
  await act(async () => nav.navigate("entry"));
  assert.equal(input(tree, "Note"), field);
  await act(async () => recovery(session.access));
  assert.equal(input(tree, "Note"), field);
  assert.equal(field.props.value, "Keep these exact edits");
  assert.equal(activityReads, reads);
  assert.equal(reviewReads, reviews);
  await act(async () => nav.goBack());
  await act(async () => tab("More").props.onPress());
  const oldClient = tree.root.findByType(query.QueryClientProvider).props.client;
  await act(async () => tree.root.findByType(QuickAdd).props.onSaved());
  assert.equal(activityReads, reads + 1, "existing save refresh reads the Home preview once");
  assert(oldClient.getQueryCache().getAll().find(item => item.queryKey[0] === "activity").state.isInvalidated);
  await act(async () => nav.goBack());
  assert.equal(activityReads, reads + 2, "hidden Activity waits until return to refresh its invalidated query");
  assert.equal(tree.root.findAllByType("FlatList")[0], list);
  await act(async () => tab("More").props.onPress());
  oldClient.setQueryData(["synthetic-private-cache"], { value: "old session" });
  const textButton = label => tree.root.findAllByType("Pressable").find(node => node.findAllByType("Text").some(text => text.props.children === label));
  await act(async () => textButton("Sign out").props.onPress());
  assert.equal(oldClient.getQueryCache().getAll().length, 0);
  const password = tree.root.findAllByType("TextInput").find(node => node.props.secureTextEntry);
  await act(async () => password.props.onChangeText("synthetic-password"));
  await act(async () => textButton("Sign in").props.onPress());
  assert.equal(nav.getCurrentRoute().name, "home");
  assert.equal(nav.canGoBack(), false);
  await act(async () => nav.navigate("entry"));
  await act(async () => button(tree, "More details").props.onPress());
  assert.equal(input(tree, "Note").props.value, "");
  assert.equal(input(tree, "Amount").props.value, "");
  assert.deepEqual(errors, [], "no React identity, lifecycle or context errors");
});
