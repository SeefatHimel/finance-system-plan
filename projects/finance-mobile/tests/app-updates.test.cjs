const { test } = require("node:test");
const assert = require("node:assert/strict");
const { nativeHarness } = require("./helpers/native-harness.cjs");

const { parseReleaseManifest, compareRelease, checkForAppUpdate } = nativeHarness().load("app-updates");
const release = { schemaVersion: 1, android: { versionCode: 31, versionName: "0.1.30", apkUrl: "https://downloads.example.com/finance-0.1.30.apk", notes: "Updated review screen." } };

test("an update appears only for a newer published Android APK", () => {
  assert.equal(compareRelease(parseReleaseManifest(release), 30).kind, "available");
  assert.equal(compareRelease(parseReleaseManifest(release), 31).kind, "current");
  assert.equal(compareRelease(parseReleaseManifest({ ...release, android: { ...release.android, apkUrl: null } }), 30).kind, "unpublished");
});

test("update metadata rejects unsafe links and malformed versions", () => {
  assert.throws(() => parseReleaseManifest({ ...release, android: { ...release.android, apkUrl: "http://downloads.example.com/app.apk" } }), /invalid/);
  assert.throws(() => parseReleaseManifest({ ...release, android: { ...release.android, apkUrl: "https://user@downloads.example.com/app.apk" } }), /invalid/);
  assert.throws(() => parseReleaseManifest({ ...release, android: { ...release.android, versionCode: "31" } }), /invalid/);
});

test("the checker reads the public manifest without authentication or backend calls", async () => {
  const originalFetch = global.fetch;
  let requested;
  global.fetch = async (url, options) => { requested = { url, options }; return { ok: true, json: async () => release }; };
  try {
    assert.equal((await checkForAppUpdate(30)).kind, "available");
    assert.match(requested.url, /^https:\/\/finance-system-plan\.vercel\.app\/mobile-release\.json\?check=/);
    assert.deepEqual(requested.options.headers, { Accept: "application/json" });
  } finally { global.fetch = originalFetch; }
});
