const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const modules = new Map();
function load(file) {
  file = resolve(file);
  if (modules.has(file)) return modules.get(file).exports;
  const mod = { exports: {} };
  modules.set(file, mod);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
    },
  }).outputText;
  new Function("module", "exports", "require", code)(mod, mod.exports, (name) =>
    load(resolve(file, "..", `${name}.ts`)),
  );
  return mod.exports;
}
const secure = load(resolve(__dirname, "../src/secure-document.ts"));
const queue = load(resolve(__dirname, "../src/quick-entry-queue.ts"));
const q = load(resolve(__dirname, "../../finance-contracts/quick-add.ts"));
function memory() {
  const data = new Map();
  return {
    data,
    getItemAsync: async (k) => data.get(k) ?? null,
    setItemAsync: async (k, v) =>
      data.set(k, Buffer.from(v, "utf8").toString("utf8")),
    deleteItemAsync: async (k) => data.delete(k),
  };
}
test("encrypted document chunks round-trip long Unicode data and incomplete writes preserve the prior version", async () => {
  const store = memory();
  const value = "ক্যাশ🙂 খরচ ".repeat(1000);
  await secure.writeSecureDocument(store, "demo", value);
  assert.equal(await secure.readSecureDocument(store, "demo"), value);
  const previous = store.data.get("demo");
  const broken = {
    ...store,
    setItemAsync: async (k, v) => {
      if (k === "demo") throw new Error("storage failure");
      return store.setItemAsync(k, v);
    },
  };
  await assert.rejects(
    secure.writeSecureDocument(broken, "demo", "new entry"),
    /storage failure/,
  );
  assert.equal(store.data.get("demo"), previous);
  assert.equal(await secure.readSecureDocument(store, "demo"), value);
  const head = JSON.parse(previous);
  store.data.delete(`demo.${head.generation}.0`);
  await assert.rejects(secure.readSecureDocument(store, "demo"), /incomplete/);
});
test("pending records retain separate purchase identities and reject malformed or duplicate queue records", () => {
  const draft = { ...q.newQuickDraft(), account: "cash", amount: "50" };
  const first = q.buildQuickEntry(draft, q.newEntryId(), "mobile");
  const second = q.buildQuickEntry(draft, q.newEntryId(), "mobile");
  const items = [first, second].map((input) => ({
    input,
    attempts: 0,
    retryAt: 0,
    error: "",
    blocked: false,
  }));
  const restored = queue.readPendingEntries(JSON.stringify(items));
  assert.equal(restored.length, 2);
  assert.deepEqual(restored[0].input, first);
  assert.throws(
    () => queue.readPendingEntries(JSON.stringify([items[0], items[0]])),
    /invalid/,
  );
  assert.throws(
    () =>
      queue.readPendingEntries(
        JSON.stringify([{ ...items[0], input: { ...first, time: "25:00" } }]),
      ),
    /invalid/,
  );
  assert.equal(queue.quickRetryAt(0, 1000), 16000);
  assert.equal(queue.quickRetryAt(99, 1000), 901000);
});
test("local documents are separated by backend and user, including expired-token offline scopes", () => {
  const token = (id) =>
    `header.${Buffer.from(JSON.stringify({ user_id: id, exp: 1 })).toString("base64url")}.signature`;
  assert.notEqual(
    secure.quickSessionScope(token(1), "https://one.invalid"),
    secure.quickSessionScope(token(2), "https://one.invalid"),
  );
  assert.notEqual(
    secure.quickSessionScope(token(1), "https://one.invalid"),
    secure.quickSessionScope(token(1), "https://two.invalid"),
  );
  assert.equal(secure.quickSessionScope("bad", "https://one.invalid"), null);
});

test("full-entry handoff preserves transfer and text fields in the API request", async () => {
  const mod = { exports: {} };
  let captured;
  const code = ts.transpileModule(
    readFileSync(resolve(__dirname, "../src/api.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    },
  ).outputText;
  new Function("module", "exports", "require", code)(mod, mod.exports, () => ({
    boundedFetch: async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(null, { status: 201 });
    },
  }));
  await mod.exports.createTransaction("synthetic-token", {
    account: "demo-sender",
    transfer_account: "demo-receiver",
    direction: "credit",
    type: "transfer",
    category: "",
    amount: "1,250.50",
    balance_after: "",
    date: "2026-10-11",
    time: "",
    note: "Synthetic note",
    counterparty_text: "Synthetic merchant",
    external_key: "synthetic-request",
  });
  assert.equal(captured.transfer_account, "demo-receiver");
  assert.equal(captured.direction, "credit");
  assert.equal(captured.amount, 1250.5);
  assert.equal(captured.counterparty_text, "Synthetic merchant");
  assert.equal(captured.external_key, "synthetic-request");
  assert.equal(captured.time, null);
  assert.equal(captured.source, "mobile");
});
