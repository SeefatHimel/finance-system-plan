# Signed Android Release

This guide creates a signed Android APK for personal installation and an AAB
for stores that accept the app's SMS permissions. Release signing credentials
stay outside the repository.

## Prerequisites

- Android Studio with the Android SDK and command-line tools.
- JDK 17 available through `JAVA_HOME`.
- A physical Android phone for validating SMS capture.

Verify the local toolchain before building:

```bash
java -version
adb version
```

On macOS with a standalone JDK 17 installation, the current shell can select it
with:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

## 1. Confirm the production API

The local `.env` file should contain the deployed HTTPS API URL:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://finance-system-plan.onrender.com
```

Expo embeds `EXPO_PUBLIC_*` values in the application bundle at build time.
Rebuild the APK after changing this value.

## 2. Create the permanent upload key

Run this once:

```bash
mkdir -p ~/.android
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore ~/.android/finance-upload-key.jks \
  -alias finance-upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Store the keystore and passwords in a password manager and keep an offline
backup. Every update installed over the existing app must be signed with the
same key.

## 3. Configure private Gradle properties

Add these values to `~/.gradle/gradle.properties`, not to a file in this
repository:

```properties
FINANCE_UPLOAD_STORE_FILE=/Users/YOUR_USER/.android/finance-upload-key.jks
FINANCE_UPLOAD_KEY_ALIAS=finance-upload
FINANCE_UPLOAD_STORE_PASSWORD=YOUR_KEYSTORE_PASSWORD
FINANCE_UPLOAD_KEY_PASSWORD=YOUR_KEY_PASSWORD
```

The Android build also accepts the same four names as environment variables,
which is useful for CI secret stores. The release task fails instead of falling
back to the debug key when any value is missing.

## 4. Set the release version

Before distributing an update, increase `versionCode` and update `versionName`
in `android/app/build.gradle`. Keep `expo.version` and `expo.android.versionCode`
in `app.json` aligned with those native values, including when regenerating the
Android project. Update the version in `package.json`, the root package entries
in `package-lock.json`, and the SMS device-status `app_version` values in
`App.tsx`. Android requires a larger `versionCode` for every upgrade.

The current release is **0.1.12**, Android version code **13**. It adds bounded
batch SMS uploads with per-item receipts, atomic local acknowledgement and
retry-safe duplicate protection. It also includes session-scoped account caches,
paged review and explicit restoration of redacted SMS. Native restoration changes require installing this APK; a web
or API deployment alone cannot update the installed Android module. It retains
0.1.10's Quick Add keyboard fixes and 0.1.9's native session bridge correction.
Command-only session/scheduling methods now resolve without a result. It includes
the recent transfer comparison layout, review date/time and Debit/Credit controls,
account-labelled balance conflict choices, compact explanation icons and
review-only short account/card suffix suggestions. It retains the SMS sync,
Quick Add and scheduling improvements from earlier releases. The shared Add/Edit
editor and latest-action Undo controls are web features and are not native
controls in this APK.

## 5. Build the signed APK

From `projects/finance-mobile`:

```bash
npm install
cd android
NODE_ENV=production ./gradlew clean assembleRelease
```

The APK is created at:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Keep a versioned copy outside Gradle's output folder, which can be replaced by
the next build. From the `android` directory, for the current release:

```bash
mkdir -p ../dist/releases
cp app/build/outputs/apk/release/app-release.apk ../dist/releases/finance-mobile-0.1.12.apk
```

The `dist/` directory is ignored by Git; release binaries stay out of commits.

The repository already contains the native Android project and SMS capture
module. Do not run `expo prebuild --clean` before a release unless native files
are intentionally being regenerated and reviewed.

## 6. Verify and install

Verify the signature with the Android SDK build-tools version installed on the
machine:

```bash
$ANDROID_HOME/build-tools/<version>/apksigner verify \
  --verbose \
  --print-certs \
  app/build/outputs/apk/release/app-release.apk
```

Install or upgrade it on a connected phone:

```bash
adb install -r app/build/outputs/apk/release/app-release.apk
```

If an older build was signed by another key, Android will reject the upgrade.
Back up its data if necessary, uninstall it, and then install the new APK.

## 7. Build an Android App Bundle

For a store build:

```bash
./gradlew clean bundleRelease
```

The AAB is created at:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

Public store distribution is separate from personal APK installation. This app
requests `READ_SMS` and `RECEIVE_SMS`; review the target store's SMS permission,
privacy-policy, consent, and disclosure requirements before submitting it.

## Release smoke test

Test on a physical Android phone:

1. Install the signed release APK and verify icons on the login screen, bottom
   navigation and empty review state, including a cold launch without internet.
   Then sign in. The bundled icon font depends on the `expo-file-system` native
   module included in this project; installing Expo Go does not supply modules
   to the standalone APK.
2. Confirm the production API health check succeeds.
3. Load payment methods and sender rules.
   Verify all capture-policy/retention options fit the screen and wrap as needed.
   Swipe across a setting without changing it, then verify a deliberate tap
   changes only that setting.
4. Enable only trusted sender rules and grant SMS permissions.
5. Sync the rules to native capture.
6. Receive a matching test SMS.
7. Import captured messages and sync the queued item.
8. Confirm it appears in the SMS review inbox and can become a transaction.
9. Close and reopen the app to verify queues and authentication survive restart.

For the 0.1.4 upgrade smoke test, install over the existing app with the same
signing key. Confirm that previously queued SMS begin uploading and the header
count falls after successful requests. Compare header and capture-section counts;
check that pending manual transactions are labelled separately. Check the header
below the Android notification bar and the privacy card at default and enlarged
font sizes. Verify one rejected sender cannot block other messages, retry after a
network interruption, and check progress after reopening the app. Use synthetic
messages for repeatable tests and keep private SMS out of screenshots/logs.

For the 0.1.5 upgrade smoke test, verify Quick Add from the header, Home, Activity
and More. Create a synthetic preset, change its defaults for one entry and Save.
Check Android clock hour/minute selection and exact input, Today/Yesterday,
unknown time, keyboard layout and the visible Save footer. Save offline, reopen
and reconnect; verify the pending entry syncs once and the notification changes
from device save to ledger sync. Check two equal purchases stay separate. The
backend must have `quick_add.0001_initial` applied before using these endpoints.
The native picker is autolinked from the installed dependency; preserve the
tracked Android SMS/signing configuration instead of regenerating it with
`expo prebuild --clean`.

For the 0.1.6 upgrade check, interrupt connectivity with synthetic SMS pending,
then restore it or switch Wi-Fi/mobile data. Confirm the saved count stays
unchanged on failed uploads and falls as successful responses are acknowledged.
Use Retry during backoff and verify it requests fresh work instead of queuing
behind the delayed chain. Running uploads must not be cancelled. Check the amber
Waiting state, retry timing, correction counts and recovery after app resume.
Do not uninstall or clear app data to fix a retained queue.

For 0.1.7, exercise foreground API calls during a large SMS sync and after access
token expiry. Verify uploads resume without invalidating the active session.
Check Show sync diagnostics for stage, HTTP/error code, worker state and counts;
Share diagnostics must contain no message body, sender, user or credential.
Test slow responses, rejected records and a temporarily failing first record
with synthetic data. A failing record must not block valid later records.

Release 0.1.8 is superseded because its sign-in bridge failed. Use 0.1.12 with
the same signing key. Verify transfer comparison
scrolling and fixed actions, local review date/time, direction changes retaining
edited fields, required same-account balance choices, tap-to-open help, and
explicit short-suffix account/card selections. Selecting a suggestion or reading
help must not save a transaction. Physical-device checks remain necessary.

For 0.1.9, upgrade directly over 0.1.8 using the same signing key. Sign-in must
complete without an unknown native type error. Verify logout, sign-in again,
foreground/background token refresh and retained queued SMS. Command-only native
functions must return Unit; session getters/refresh return explicit maps. Native
bridge regression tests exercise the installed Expo converter and retain storage
errors. Signature/build verification does not replace a device sign-in check.

The 0.1.9 release was built and verified with:

```bash
# From projects/finance-mobile
npm run typecheck
cd android
NODE_ENV=production ./gradlew :finance-sms-capture:testReleaseUnitTest assembleRelease
```

All 23 native tests passed, including the three bridge conversion regressions.
The release signature matches the previous APK, Android code is 10, and the
embedded JavaScript and MaterialCommunityIcons font are present. Physical-device
sign-in and SMS smoke tests remain unverified.

For 0.1.10 (Android code 11), install over the existing app using the same signing
key. In More > Quick Add presets, create and edit a preset: type in its name,
default amount, merchant and note; switch fields and scroll with the keyboard
open. Repeat through the header plus button for a Quick Add transaction. Verify
that the keyboard stays usable, the focused field remains visible, and returning
from the background preserves the draft. Wait for a reference refresh while
typing. Save/Cancel must remain reachable on a small screen. These checks need a
physical device, particularly the reported OnePlus 12R / Android 16.

Run `npm run test:quick-add-focus` alongside the existing mobile checks before
assembly. Its component tests cover native-window focus timing, manager/editor
transitions, cancellation and retained drafts; mocked native views do not verify
an Android IME.

The 0.1.10 build passed typecheck, 23 JavaScript tests, 23 native tests and signed
assembly. Package metadata is 0.1.10/code 11, the signing certificate matches
0.1.9, and the embedded JavaScript and exact icon font were verified. Device
keyboard checks remain pending.

For 0.1.11 (Android code 12), upgrade in place with the existing signing key and
use the current backend API. Verify session restoration, logout/account switching,
offline cache separation and loading additional SMS review pages. Historical
reprocessing must respect previous redactions by default; restoring previously
redacted SMS requires the explicit restoration option. Also smoke-test Quick Add
typing and SMS upload after upgrading. Do not uninstall to apply the update, as
uninstalling removes device-local queues and secure storage.

Before assembly, run `npm run typecheck` and `node --test tests/*.test.cjs` from
the mobile project. Then run the native test/assembly command above. Verify APK
version, signing identity, embedded JavaScript and icon font before distributing.
These checks do not replace testing the installed app on a physical Android phone.

The 0.1.11 release passed typecheck, all 23 JavaScript tests, all 23 native tests
and signed assembly. Package metadata is 0.1.11/code 12 and the signing certificate
matches 0.1.10. The embedded production API URL, JavaScript, icon font and native
restoration update were verified. Physical-device smoke checks remain pending.
## Batch-sync release 0.1.12

Deploy the batch-capable API first, then install version 0.1.12/code 13 over the
existing signed app. A backend without the batch route remains usable through
single-message fallback, so that compatibility path does not provide the speedup.
No database migration or local queue reset is required for this feature.

Smoke-test a long SMS history, disconnect during a batch, reconnect/restart and
confirm only unacknowledged messages retry. Verify no extra ledger entries, a
malformed response cannot empty the queue, account changes stop uploads, and
manual redactions stay respected unless restoration is explicitly selected.
Counters may advance by up to 25 after each batch acknowledgement. For service
outages, leave queued SMS intact and allow normal retry/backoff. Check keyboard,
sign-in and regular background capture after upgrading as well.

Release verification passed: 498 backend tests on isolated PostgreSQL (including
concurrent imports), 38 native tests, 23 mobile JavaScript tests, Python lint,
mobile/web/contract typechecks, schema drift and migration checks, and signed
assembly. The APK reports 0.1.12/code 13, matches the 0.1.11 signing certificate,
and contains the JavaScript bundle, production API URL, icon font and native
batch route. The real-HTTP queue test uploaded 552 messages in 23 requests.
Physical-phone performance and background smoke checks remain pending.

After deployment, an unauthenticated request to `/api/messages/import/batch/`
should resolve to the protected API (normally HTTP 401), rather than route-level
404. A successful Git push or APK installation alone does not establish that the
backend deployment has completed.
