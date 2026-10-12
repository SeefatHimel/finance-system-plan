const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const mod = { exports: {} };
const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src/sms-sync-presentation.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
new Function("module", "exports", code)(mod, mod.exports);
const { smsSyncPresentation, smsSyncDiagnostics } = mod.exports;
const status = { pendingCount: 552, importedCount: 0, rejectedCount: 0, state: "error", updatedAt: "", message: "Synthetic error" };

test("DNS errors distinguish waiting from records needing correction, including older status payloads", () => {
  const view = smsSyncPresentation({ ...status, failureKind: "network" }, 552);
  assert.equal(view.label, "Waiting");
  assert.equal(view.tone, "waiting");
  assert.equal(view.waiting, true);
  const old = smsSyncPresentation({ ...status, message: 'Unable to resolve host "synthetic.invalid": No address associated with hostname' }, 552);
  assert.equal(old.label, "Waiting");
  assert.match(old.message, /remain saved/);
});
test("authentication and rejected records need attention while a server outage retries", () => {
  assert.equal(smsSyncPresentation({ ...status, failureKind: "auth" }, 552).label, "Attention");
  assert.equal(smsSyncPresentation({ ...status, failureKind: "rejected", rejectedCount: 4 }, 4).tone, "error");
  assert.equal(smsSyncPresentation({ ...status, failureKind: "server" }, 552).label, "Waiting");
});
test("stale running text cannot disable retry when no worker is running", () => {
  assert.equal(smsSyncPresentation({ ...status, state: "running", workerRunning: false }, 552).running, false);
  assert.equal(smsSyncPresentation({ ...status, state: "running", workerRunning: true }, 552).label, "Syncing");
  assert.equal(smsSyncPresentation({ ...status, state: "success", message: "Uploaded" }, 0).label, "Ready");
});

test("sync diagnostics allow only operational metadata and omit message and credential fields", () => {
  const value = JSON.parse(smsSyncDiagnostics({ ...status, stage: "auth_refresh", httpCode: 401,
    body: "private synthetic SMS", sender: "synthetic sender", access: "synthetic-access",
    refresh: "synthetic-refresh", message: "private synthetic response", username: "synthetic-user" }, "test-version", "https://synthetic-token:password@api.test:443/path?secret=test"));
  assert.equal(value.foregroundHost, "api.test");
  assert.equal(value.stage, "auth_refresh"); assert.equal(value.httpCode, 401); assert.equal(value.pendingCount, 552);
  for (const field of ["body", "sender", "access", "refresh", "message", "username"]) assert.equal(field in value, false);
});

function loadApi(fetch) {
  const api = { exports: {} };
  const scopeModule = { exports: {} };
  const compile = file => ts.transpileModule(readFileSync(resolve(__dirname, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  new Function("module", "exports", compile("../src/secure-document.ts"))(scopeModule, scopeModule.exports);
  new Function("module", "exports", "require", compile("../src/api.ts"))(api, api.exports, name =>
    name === "./secure-document" ? scopeModule.exports : { boundedFetch: fetch });
  return api.exports;
}
const jwt = (user, tag) => `header.${Buffer.from(JSON.stringify({ user_id: user, tag })).toString("base64url")}.signature`;

test("foreground recovery receives the rejected token and reuses the refreshed same-user session", async () => {
  const old = jwt(1, "old"), current = jwt(1, "current");
  const seen = [];
  const api = loadApi(async (_url, request) => {
    seen.push(request.headers.Authorization);
    return new Response(JSON.stringify(seen.length === 1 ? { detail: "Expired" } : []), { status: seen.length === 1 ? 401 : 200 });
  });
  api.configureAuthenticationRecovery(async rejected => { assert.equal(rejected, old); return current; });
  assert.deepEqual(await api.listAccounts(old), []);
  assert.deepEqual(seen, [`Bearer ${old}`, `Bearer ${current}`]);
});
test("a user switch during recovery cannot replay an old user's request with the new user's token", async () => {
  let attempts = 0;
  const api = loadApi(async () => { attempts++; return new Response('{}', { status: 401 }); });
  api.configureAuthenticationRecovery(async () => jwt(2, "different-user"));
  await assert.rejects(api.listAccounts(jwt(1, "old-user")), /signed-in user changed/);
  assert.equal(attempts, 1);
});
