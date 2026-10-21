const { nativeHarness, React, create, act } = require("./native-harness.cjs");
const query = require("@tanstack/react-query");
query.notifyManager.setScheduler(callback => queueMicrotask(callback));

// Real App, navigation, fields and mutation hooks; only the native host/API are mocked.
async function mobileAppHarness(t, overrides = {}) {
  const core = await import("@react-navigation/core");
  let tree;
  const errors = [], alerts = [];
  t.mock.method(console, "error", (...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated")) errors.push(args.join(" "));
  });
  global.__DEV__ = false;
  global.requestAnimationFrame = callback => setTimeout(callback, 0);
  global.cancelAnimationFrame = clearTimeout;
  let session = { username: "demo", access: `header.${Buffer.from(JSON.stringify({ user_id: "synthetic-owner" })).toString("base64url")}.signature`, refresh: "synthetic-refresh" };
  const account = { id: "bank", name: "Demo bank", type: "bank", currency: "BDT", current_balance: "100.00", opening_balance: "0.00", is_active: true };
  const api = {
    getApiBaseUrl: () => "https://synthetic.invalid", checkHealth: async () => ({ ok: true }),
    configureAuthenticationRecovery() {}, getCurrentUser: async () => ({ id: "synthetic-owner", username: "demo" }),
    listAccounts: async () => [account, { ...account, id: "wallet", name: "Demo wallet", type: "wallet" }],
    listCategories: async () => [{ id: "food", name: "Food", kind: "expense", is_active: true }, { id: "transfer", name: "Account Transfer", kind: "transfer", is_active: true }],
    listPaymentMethods: async () => [], listSenderRules: async () => [],
    listTransactionActivity: async () => ({ count: 0, next_offset: null, results: [] }),
    listMessageCandidates: async () => ({ count: 0, results: [] }),
    getSmsCapturePreference: async () => ({ excluded_providers: [], excluded_message_kinds: [], raw_sms_retention_days: null }),
    getSmsDeviceStatus: async () => null, recentTransactionAction: async () => null, listDebts: async () => [],
    AuthenticationError: class AuthenticationError extends Error {}, ...overrides,
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
      isNativeSmsCaptureAvailable: () => false, getNativeSmsBackgroundSyncStatus: async () => null,
      getNativeSmsBackgroundSyncSession: async () => null, initializeNativeSmsSession: async () => {}, getCapturedSmsMessages: async () => [],
    },
  });
  Object.assign(h.native, {
    Alert: { alert: (...args) => alerts.push(args) },
    useColorScheme: () => "dark", Appearance: { setColorScheme() {} }, Keyboard: { dismiss() {} },
    Animated: { Value: class { setValue() {} }, timing: () => ({ start: callback => callback?.({ finished: true }) }), View: "AnimatedView" },
    Easing: { out: () => {}, in: () => {}, cubic() {} },
  });
  h.native.AppState.currentState = "active";
  h.native.StyleSheet.flatten = value => Array.isArray(value) ? Object.assign({}, ...value) : value;
  const { default: App } = h.load("../App");
  t.after(async () => {
    if (tree) await act(async () => tree.unmount());
    require("node:assert/strict").deepEqual(errors, [], "no React identity/lifecycle/context errors");
  });
  await act(async () => { tree = create(React.createElement(App)); });
  const { RetainedNavigation } = h.load("retained-navigation");
  const nav = tree.root.findByType(RetainedNavigation).props.navigation;
  const { ReviewFields } = h.load("review-fields");
  const textButton = label => tree.root.findAllByType("Pressable").find(node => node.findAllByType("Text").some(text => text.props.children === label));
  return { tree, nav, alerts, textButton,
    fields: () => tree.root.findByType(ReviewFields),
    async review() { await act(async () => nav.navigate("review")); },
  };
}
module.exports = { mobileAppHarness };
