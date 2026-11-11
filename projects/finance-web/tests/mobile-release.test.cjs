const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const ts = require("typescript");

const source = readFileSync(join(__dirname, "../lib/mobile-release.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
new Function("exports", compiled)(moduleExports);
const { mobileManifestFromRelease } = moduleExports;
const tag = "mobile-v0.1.30-code31";
const assetName = "finance-mobile-0.1.30.apk";
const url = `https://github.com/SeefatHimel/finance-system-plan/releases/download/${tag}/${assetName}`;
const release = { tag_name: tag, draft: false, prerelease: false, body: "More compact review.\nOther details", assets: [{ name: assetName, state: "uploaded", size: 60_000_000, browser_download_url: url }] };

test("only a published, uploaded APK becomes an update manifest", () => {
  assert.deepEqual(mobileManifestFromRelease(release), { schemaVersion: 1, android: { versionCode: 31, versionName: "0.1.30", apkUrl: url, notes: "More compact review." } });
  assert.equal(mobileManifestFromRelease({ ...release, draft: true }), null);
  assert.equal(mobileManifestFromRelease({ ...release, prerelease: true }), null);
  assert.equal(mobileManifestFromRelease({ ...release, assets: [] }), null);
});

test("rejects mismatched tags, asset names, and download locations", () => {
  assert.equal(mobileManifestFromRelease({ ...release, tag_name: "other-v0.1.30-code31" }), null);
  assert.equal(mobileManifestFromRelease({ ...release, assets: [{ ...release.assets[0], name: "other.apk" }] }), null);
  assert.equal(mobileManifestFromRelease({ ...release, assets: [{ ...release.assets[0], browser_download_url: "https://example.com/other.apk" }] }), null);
  assert.equal(mobileManifestFromRelease({ ...release, assets: [{ ...release.assets[0], state: "new" }] }), null);
});
