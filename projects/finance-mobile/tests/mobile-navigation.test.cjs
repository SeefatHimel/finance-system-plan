const { test } = require("node:test");
const assert = require("node:assert/strict");
const { nativeHarness, React, create, act, input, button } = require("./helpers/native-harness.cjs");
const query = require("@tanstack/react-query");
query.notifyManager.setScheduler(callback => queueMicrotask(callback));

async function navigationHarness() {
  const core = await import("@react-navigation/core");
  const frames = new Map(); let nextFrame = 0;
  global.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  global.cancelAnimationFrame = id => frames.delete(id);
  const native = nativeHarness({}, "android", {
    "@react-navigation/native": { ...core, NavigationContainer: core.BaseNavigationContainer },
    "@tanstack/react-query": query,
  });
  native.native.AppState.currentState = "active";
  const { RetainedNavigation } = native.load("retained-navigation");
  const { WorkspaceScrollView } = native.load("retained-scroll");
  const { MobileQueryProvider } = native.load("mobile-query");
  const { ManualEntryFields } = native.load("manual-entry-fields");
  const navigation = core.createNavigationContainerRef();
  const mounts = {}, renders = {}, scrollCalls = [], instances = [];
  let tree, route, scope = "owner-a", token = "token-a", client;
  function Probe({ name, focused }) {
    renders[name] = (renders[name] || 0) + 1;
    React.useEffect(() => { mounts[name] = (mounts[name] || 0) + 1; }, []);
    client = query.useQueryClient();
    const [text, setText] = React.useState("");
    const [draft, setDraft] = React.useState({ account: "bank", category: "", type: "expense", direction: "debit", transfer_account: "", amount: "", balance_after: "", date: "2026-10-01", time: "16:17:29", note: "", counterparty_text: "" });
    return React.createElement(WorkspaceScrollView, { focused, testID: `scroll-${name}` },
      name === "entry" ? React.createElement(ManualEntryFields, {
        draft, onChange: patch => setDraft(old => ({ ...old, ...patch })),
        accounts: [{ id: "bank", name: "Demo bank", currency: "BDT" }], categories: [], busy: false,
      }) : React.createElement("TextInput", { accessibilityLabel: `draft-${name}`, value: text, onChangeText: setText }),
      React.createElement("Text", null, token));
  }
  const render = () => React.createElement(MobileQueryProvider, { key: scope }, React.createElement(RetainedNavigation, {
    navigation, onRouteChange: value => { route = value; },
    render: (name, focused) => React.createElement(Probe, { name, focused }),
  }));
  function flushFrames() {
    while (frames.size) { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); }
  }
  return {
    mounts, renders, navigation, scrollCalls, instances,
    get client() { return client; }, get tree() { return tree; }, get route() { return route; },
    async mount() {
      await act(async () => { tree = create(render(), { createNodeMock(element) {
        if (element.type !== "ScrollView") return null;
        const instance = { name: element.props.testID, scrollTo: options => scrollCalls.push({ name: element.props.testID, ...options }) };
        instances.push(instance); return instance;
      } }); });
      await act(async () => flushFrames());
    },
    async go(name) { await act(async () => navigation.navigate(name)); await act(async () => flushFrames()); },
    async back() { await act(async () => navigation.goBack()); await act(async () => flushFrames()); },
    async edit(label, value) { await act(async () => input(tree, label).props.onChangeText(value)); },
    async rotate() { token = "rotated-token"; await act(async () => tree.update(render())); },
    async owner(value) { scope = value; await act(async () => tree.update(render())); await act(async () => flushFrames()); },
    async dispose() { await act(async () => tree.unmount()); },
    scroll(name) { return tree.root.findAllByType("ScrollView").find(node => node.props.testID === `scroll-${name}`); },
  };
}

test("real navigation history lazily retains drafts, native scroll views and disclosure state across Back", async () => {
  const h = await navigationHarness(); await h.mount();
  assert.deepEqual(h.mounts, { home: 1 });
  await h.go("activity");
  await h.edit("draft-activity", "Unsent search");
  const field = input(h.tree, "draft-activity"), scroll = h.scroll("activity");
  await act(async () => {
    scroll.props.onScrollBeginDrag();
    scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 640 } } });
  });
  await h.go("accounts"); await h.go("reconciliation");
  assert.equal(h.route, "reconciliation");
  await h.back(); assert.equal(h.route, "accounts");
  await h.back(); assert.equal(h.route, "activity");
  assert.equal(input(h.tree, "draft-activity"), field);
  assert.equal(input(h.tree, "draft-activity").props.value, "Unsent search");
  assert.equal(h.scroll("activity"), scroll);
  assert(h.scrollCalls.some(call => call.name === "scroll-activity" && call.y === 640 && !call.animated));
  assert.equal(h.mounts.activity, 1);
  await h.go("entry");
  await act(async () => button(h.tree, "More details").props.onPress());
  await h.edit("Note", "Do not lose this manual draft");
  await h.edit("Amount", "123.45");
  const note = input(h.tree, "Note");
  await h.back(); await h.go("entry"); await h.rotate();
  assert.equal(input(h.tree, "Note"), note);
  assert.equal(input(h.tree, "Note").props.value, "Do not lose this manual draft");
  assert.equal(input(h.tree, "Amount").props.value, "123.45");
  assert.equal(button(h.tree, "More details").props.accessibilityState.expanded, true);
  assert.equal(h.mounts.entry, 1);
  const wrappers = h.tree.root.findAllByType("View").filter(node => node.props.importantForAccessibility && node.props.pointerEvents);
  assert.equal(wrappers.filter(node => node.props.importantForAccessibility === "auto").length, 1);
  assert(wrappers.filter(node => node.props.importantForAccessibility === "no-hide-descendants").every(node => node.props.pointerEvents === "none"));
  await h.dispose();
});

test("user/backend session replacement destroys history, drafts, scroll and query data", async () => {
  const h = await navigationHarness(); await h.mount(); await h.go("review");
  await h.edit("draft-review", "Private unsaved value");
  const oldField = input(h.tree, "draft-review"), oldClient = h.client;
  oldClient.setQueryData(["activity", "owner-a"], { private: true });
  let signal;
  const pending = oldClient.fetchQuery({ queryKey: ["pending"], queryFn: context => {
    signal = context.signal;
    return new Promise(() => {});
  } }).catch(() => {});
  await h.owner("owner-b"); await pending;
  assert(signal.aborted);
  assert.equal(oldClient.getQueryCache().getAll().length, 0);
  assert.equal(h.route, "home");
  assert.equal(h.navigation.canGoBack(), false);
  assert.notEqual(h.client, oldClient);
  assert.equal(h.client.getQueryCache().getAll().length, 0);
  await h.go("review");
  assert.notEqual(input(h.tree, "draft-review"), oldField);
  assert.equal(input(h.tree, "draft-review").props.value, "");
  await h.dispose();
});

test("hidden layout events cannot overwrite a workspace's saved scroll offset", async () => {
  const h = await navigationHarness(); await h.mount();
  const home = h.scroll("home");
  await act(async () => { home.props.onScrollBeginDrag(); home.props.onScroll({ nativeEvent: { contentOffset: { y: 480 } } }); });
  await h.go("more");
  await act(async () => home.props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }));
  await h.back();
  assert.equal(h.scrollCalls.filter(call => call.name === "scroll-home").at(-1).y, 480);
  await h.dispose();
});


test("accessibility scrolling without touch drag is retained on Back", async () => {
  const h = await navigationHarness(); await h.mount();
  await act(async () => h.scroll("home").props.onScroll({ nativeEvent: { contentOffset: { y: 250 } } }));
  await h.go("profile"); await h.back();
  assert.equal(h.scrollCalls.filter(call => call.name === "scroll-home").at(-1).y, 250);
  await h.dispose();
});

test("root updates leave hidden forms alone until they receive focus", async () => {
  const h = await navigationHarness(); await h.mount(); await h.go("activity");
  const renders = h.renders.home;
  await h.rotate();
  assert.equal(h.renders.home, renders);
  await h.back();
  assert(h.renders.home > renders);
  assert.equal(h.mounts.home, 1);
  await h.dispose();
});
