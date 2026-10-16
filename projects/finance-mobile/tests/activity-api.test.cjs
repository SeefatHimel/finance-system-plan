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
