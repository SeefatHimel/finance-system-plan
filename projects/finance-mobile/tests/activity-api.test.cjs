const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
function loadApi(fetch) {
  const api = { exports: {} };
  const code = ts.transpileModule(
    readFileSync(resolve(__dirname, "../src/api.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    },
  ).outputText;
  new Function("module", "exports", "require", code)(
    api,
    api.exports,
    (name) =>
      name === "./bounded-fetch"
        ? { boundedFetch: fetch }
        : { quickSessionScope: () => "demo-user" },
  );
  return api.exports;
}
test("review status checks use an authenticated GET and reject unverifiable save outcomes", async () => {
  let seen, body = { id: "synthetic-id", status: "needs_review", transaction: null };
  const api = loadApi(async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(body)); });
  for (const status of ["needs_review", "confirmed", "ignored"]) {
    body = { id: "synthetic-id", status, transaction: status === "confirmed" ? "saved-entry" : null };
    assert.equal((await api.getMessageCandidate("synthetic-token", body.id)).status, status);
  }
  assert.equal(new URL(seen.url).pathname, "/api/messages/review/synthetic-id/");
  assert.equal(seen.init.method ?? "GET", "GET");
  assert.equal(seen.init.headers.Authorization, "Bearer synthetic-token");
  assert(!seen.url.includes("synthetic-token"));
  for (body of [null, {}, { id: "wrong-id", status: "needs_review" }, { id: "synthetic-id", status: "unexpected" }, { id: "synthetic-id", status: "confirmed", transaction: null }]) {
    await assert.rejects(api.getMessageCandidate("synthetic-token", "synthetic-id"), /could not be verified/);
  }
});
test("activity requests a bounded filtered page and forwards cancellation without placing credentials in the URL", async () => {
  let seen;
  const api = loadApi(async (url, init) => {
    seen = { url, init };
    return new Response(
      JSON.stringify({
        count: 26,
        results: [{ id: "last" }],
        next_offset: null,
      }),
    );
  });
  const controller = new AbortController();
  await api.listTransactionActivity(
    "synthetic-token",
    {
      search: "Demo & Cafe",
      account: "demo-bank",
      category: "demo-category",
      month: "2026-10",
    },
    25,
    controller.signal,
  );
  const url = new URL(seen.url);
  assert.equal(url.pathname, "/api/transactions/activity/");
  assert.equal(url.searchParams.get("limit"), "25");
  assert.equal(url.searchParams.get("offset"), "25");
  assert.equal(url.searchParams.get("search"), "Demo & Cafe");
  assert.equal(url.searchParams.get("account"), "demo-bank");
  assert.equal(seen.init.headers.Authorization, "Bearer synthetic-token");
  assert.equal(seen.init.signal, controller.signal);
  assert(!seen.url.includes("synthetic-token"));
});
test("malformed page metadata cannot produce missing rows or endless load-more requests", async () => {
  let body;
  const api = loadApi(async () => new Response(JSON.stringify(body)));
  for (body of [
    null,
    [],
    { count: 2, results: [], next_offset: 1 },
    { count: -1, results: [], next_offset: null },
    { count: 4, results: [{ id: "same" }, { id: "same" }], next_offset: 2 },
    { count: 3, results: [{ id: "one" }], next_offset: 2 },
    { count: 1, results: [{ id: "one" }] },
  ]) {
    await assert.rejects(
      api.listTransactionActivity("synthetic-token"),
      /incomplete/,
    );
  }
  const invalidJson = loadApi(
    async () => new Response("<html>Unavailable</html>"),
  );
  await assert.rejects(
    invalidJson.listTransactionActivity("synthetic-token"),
    /could not be read/,
  );
});
test("an older backend preserves the HTTP status for the actionable deployment message", async () => {
  const api = loadApi(
    async () =>
      new Response(JSON.stringify({ detail: "Not found." }), { status: 404 }),
  );
  await assert.rejects(
    api.listTransactionActivity("synthetic-token"),
    (error) => error.status === 404,
  );
});

test("native editing patches exact decimals and account-bound balances; Undo posts only its action ID", async () => {
  const calls = [];
  const action = {
    id: "demo-action",
    label: "Transaction saved",
    can_undo: true,
    undone: false,
    transaction: "demo-entry",
    expires_at: "2026-10-18T00:00:00Z",
    created_at: "2026-10-17T00:00:00Z",
  };
  const api = loadApi(async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify(url.endsWith("/undo/") ? action : { id: "demo-entry" }),
    );
  });
  await api.updateTransaction("synthetic-token", "demo-entry", {
    amount: "123456789012.07",
    reported_balances: [
      { account: "bank", balance_after: "0.00" },
      { account: "wallet", balance_after: null },
    ],
  });
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    amount: "123456789012.07",
    reported_balances: [
      { account: "bank", balance_after: "0.00" },
      { account: "wallet", balance_after: null },
    ],
  });
  await api.undoTransactionAction("synthetic-token", "demo-action");
  assert.equal(new URL(calls[1].url).pathname, "/api/transactions/undo/");
  assert.deepEqual(JSON.parse(calls[1].init.body), { action: "demo-action" });
  assert(calls.every((call) => !call.url.includes("synthetic-token")));
});
test("recovery rejects malformed receipts; validation errors remain readable and server debug text stays private", async () => {
  const malformed = loadApi(
    async () => new Response(JSON.stringify({ id: "demo", can_undo: true })),
  );
  await assert.rejects(
    malformed.recentTransactionAction("synthetic-token"),
    /could not be read/,
  );
  const invalid = loadApi(
    async () =>
      new Response(
        JSON.stringify({
          reported_balances: [{ balance_after: ["Enter a valid amount."] }],
        }),
        { status: 400 },
      ),
  );
  await assert.rejects(
    invalid.updateTransaction("synthetic-token", "demo-entry", {}),
    /reported balances · balance after: Enter a valid amount/,
  );
  const unavailable = loadApi(
    async () => new Response("private server diagnostics", { status: 500 }),
  );
  await assert.rejects(
    unavailable.updateTransaction("synthetic-token", "demo-entry", {}),
    (error) =>
      /server is temporarily unavailable/.test(error.message) &&
      !error.message.includes("private server"),
  );
});
