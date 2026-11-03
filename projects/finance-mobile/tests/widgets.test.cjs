const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");

function load(file, nativeWidgets) {
  const source = readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, name => {
    if (name === "react-native") return { Platform: { OS: "android" }, NativeModules: nativeWidgets ? { FinanceWidgets: nativeWidgets } : {} };
    if (name.startsWith(".")) return load(resolve(dirname(file), name + ".ts"), nativeWidgets);
    throw new Error(`Unexpected import: ${name}`);
  });
  return module.exports;
}

const widgets = load(resolve(__dirname, "../src/android-widgets.ts"));
const voice = load(resolve(__dirname, "../src/voice-entry.ts"));
const account = { id: "wallet", name: "Home Cash", type: "cash", currency: "BDT", ledger_balance: "500.00", is_active: true };
const transaction = { id: "tx", account: "wallet", type: "expense", direction: "debit", amount: "250.00", counterparty_text: "Shop", note: "" };
const preset = { id: "preset-1", name: "Groceries", is_enabled: true, available: true };

test("widget deep links accept only known local actions and bounded preset ids", () => {
  assert.deepEqual(widgets.parseWidgetAction("finance://widget/expense"), { kind: "expense" });
  assert.deepEqual(widgets.parseWidgetAction("finance://widget/preset/preset-1"), { kind: "preset", id: "preset-1" });
  assert.equal(widgets.parseWidgetAction("finance://widget/preset/../../logout"), null);
  assert.equal(widgets.parseWidgetAction("https://widget/expense"), null);
  assert.equal(widgets.parseWidgetAction("finance://other/expense"), null);
});

test("private defaults exclude financial values, while opt-in snapshots include only compact display fields", () => {
  const base = {
    owner: "synthetic-user", accounts: [account], transactions: [transaction],
    reviewCount: 3, presets: [preset],
    spending: { month: "2026-11", total: "BDT 250.00", topCategory: "Groceries" },
  };
  const hidden = widgets.buildWidgetSnapshot({ ...base, privacy: widgets.defaultWidgetPrivacy });
  assert.equal(hidden.showBalances, false);
  assert.deepEqual(hidden.accounts, []);
  assert.deepEqual(hidden.activity, []);
  assert.equal(hidden.spending, null);
  assert.equal(hidden.reviewCount, 3);
  const visible = widgets.buildWidgetSnapshot({ ...base, privacy: { showBalances: true, showActivity: true, showSpending: true } });
  assert.equal(visible.accounts[0].balance, "BDT 500.00");
  assert.match(visible.activity[0].amount, /250\.00/);
  assert.equal(visible.spending.total, "BDT 250.00");
});

test("widget writes serialize so clearing follows an in-flight snapshot", async () => {
  const events = [];
  let finishSync;
  const native = {
    syncSnapshot: () => { events.push("sync"); return new Promise(resolve => { finishSync = resolve; }); },
    clearSnapshot: async () => { events.push("clear"); return true; },
    getPrivacy: async () => null,
    setPrivacy: async () => true,
  };
  const module = load(resolve(__dirname, "../src/android-widgets.ts"), native);
  const syncing = module.syncWidgetSnapshot({ owner: "synthetic-user" });
  const clearing = module.clearWidgetSnapshot();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["sync"]);
  finishSync(true);
  await Promise.all([syncing, clearing]);
  assert.deepEqual(events, ["sync", "clear"]);
  assert.deepEqual(await module.readWidgetPrivacy("synthetic-user"), module.defaultWidgetPrivacy);
});

test("spoken entry fills safe fields and retains the transcript for confirmation", () => {
  const category = { id: "groceries", name: "Groceries", kind: "expense", is_active: true };
  const draft = voice.voiceDraft(
    "Add transaction groceries eggs and bread 250 taka 11 a.m. today",
    [account], [category], new Date("2026-11-02T09:00:00+06:00"),
  );
  assert.equal(draft.account, "wallet");
  assert.equal(draft.category, "groceries");
  assert.equal(draft.amount, "250");
  assert.equal(draft.time, "11:00");
  assert.equal(draft.timeMode, "custom");
  assert.equal(draft.date, "2026-11-02");
  assert.match(draft.note, /eggs and bread/);
  const ambiguous = voice.voiceDraft("250 taka", [account, { ...account, id: "second", name: "Cash Wallet" }], [], new Date("2026-11-02T09:00:00+06:00"));
  assert.equal(ambiguous.account, "");
  const overlapping = voice.voiceDraft("250 taka from EBL Credit Card", [
    { ...account, id: "ebl", name: "EBL", type: "bank" },
    { ...account, id: "card", name: "EBL Credit Card", type: "credit_card" },
  ], [], new Date("2026-11-02T09:00:00+06:00"));
  assert.equal(overlapping.account, "");
});
