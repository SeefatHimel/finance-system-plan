const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function loadApi(fetch) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src/api.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText;
  new Function("module", "exports", "require", code)(module, module.exports, name =>
    name === "./bounded-fetch" ? { boundedFetch: fetch } : { quickSessionScope: () => "same-user" }
  );
  return module.exports;
}

test("profile edit sends only editable details to the authenticated user endpoint", async () => {
  let request;
  const api = loadApi(async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({
      id: 1, username: "demo", first_name: "Alex", last_name: "Morgan", email: "alex@example.com"
    }), { status: 200 });
  });
  const result = await api.updateCurrentUser("synthetic-token", {
    first_name: "Alex", last_name: "Morgan", email: "alex@example.com"
  });
  assert.equal(new URL(request.url).pathname, "/api/auth/me/");
  assert.equal(request.init.method, "PATCH");
  assert.equal(request.init.headers.Authorization, "Bearer synthetic-token");
  assert.deepEqual(JSON.parse(request.init.body), {
    first_name: "Alex", last_name: "Morgan", email: "alex@example.com"
  });
  assert.equal(result.username, "demo");
});

test("profile validation returns readable errors without changing local details", async () => {
  const api = loadApi(async () => new Response(JSON.stringify({ email: ["Enter a valid email address."] }), { status: 400 }));
  await assert.rejects(api.updateCurrentUser("synthetic-token", {
    first_name: "Alex", last_name: "Morgan", email: "bad"
  }), /valid email address/);
});
