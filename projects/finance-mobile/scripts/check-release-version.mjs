import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tag = process.argv[2] ?? "";
const match = /^mobile-v(\d+\.\d+\.\d+)-code([1-9]\d*)$/.exec(tag);
assert(match, "Use a tag like mobile-v0.1.30-code31");
const [, versionName, codeText] = match;
const versionCode = Number(codeText);
assert(Number.isSafeInteger(versionCode), "Android version code must be a safe integer");

const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url)));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const gradle = readFileSync(new URL("../android/app/build.gradle", import.meta.url), "utf8");
assert.equal(app.expo.version, versionName, "app.json version differs from release tag");
assert.equal(pkg.version, versionName, "package.json version differs from release tag");
assert.equal(app.expo.android.versionCode, versionCode, "app.json code differs from release tag");
assert.match(gradle, new RegExp(`\\bversionCode\\s+${versionCode}\\b`), "Gradle code differs from release tag");
assert.match(gradle, new RegExp(`\\bversionName\\s+[\"']${versionName.replaceAll(".", "\\.")}[\"']`), "Gradle version differs from release tag");
assert.equal(app.expo.android.package, "com.personalfinance.mobile", "Android package ID changed");
console.log(`Verified ${tag} against Expo, npm, and Gradle.`);
