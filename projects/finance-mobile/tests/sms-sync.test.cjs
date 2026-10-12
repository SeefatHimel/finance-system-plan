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
const { smsSyncPresentation } = mod.exports;
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
