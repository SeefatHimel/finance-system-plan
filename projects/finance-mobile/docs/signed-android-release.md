# Signed Android Release

This guide creates a signed Android APK for personal installation and an AAB
for stores that accept the app's SMS permissions. Release signing credentials
stay outside the repository.

For builds including retained workspace navigation, also follow the
[navigation acceptance checklist](navigation-state.md#verification). In
particular, check Android Back/keyboard dismissal, long-list scroll restoration,
unsaved review/manual/profile forms, stale/offline background refresh and
logout/relogin. The automated navigation tests and Metro export do not replace
these physical-device checks.

For immediate SMS review updates, also follow the
[save/retry acceptance checklist](review-save-recovery.md#verification): slow
approval/rejection, both pending transfer sources, exact draft rollback, editing
the next message, lost responses, repeated taps, shifted pages, Undo, and logout
during a save. This JavaScript change requires a new APK but no new native module
or migration. Do not call phone/network/TalkBack behavior verified from the
automated host tests or Metro export alone.

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

The current release is **0.1.16**, Android version code **17**. It adds profile
editing and device-local System, Light and Dark appearance choices. Deploy the
API with `PATCH /api/auth/me/` before using profile edits in this APK. There is
no database migration or queue reset.

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
cp app/build/outputs/apk/release/app-release.apk ../dist/releases/finance-mobile-0.1.16.apk
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

Release 0.1.8 is superseded because its sign-in bridge failed. Use 0.1.14 with
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

## Native workflow release 0.1.13

Build only after mobile typecheck, the complete JavaScript suite and Android
module unit tests pass. From `projects/finance-mobile` run:

```bash
npm run typecheck
npm test
npm run test:review
cd android
NODE_ENV=production ./gradlew :finance-sms-capture:testReleaseUnitTest
NODE_ENV=production ./gradlew assembleRelease
```

Keep the existing keystore. Verify version **0.1.13/code 14**, package
`com.personalfinance.mobile`, label **Finance**, the production HTTPS API URL,
the bundled icon font and the signing certificate against the preceding APK.
Copy the APK to `dist/releases/finance-mobile-0.1.13.apk`; do not commit binaries.
No reset/uninstall is necessary for an upgrade signed with the same key.

Physical-device acceptance remains required:

- Open searchable account/category sheets, type, scroll without selecting, Cancel,
  select explicitly, and try an incompatible category/type decision.
- Open/cancel native date and time dialogs; edit amount, note and a zero reported
  balance while data refreshes. Verify the keyboard remains open while typing.
- Read a long full SMS; verify redacted text remains unavailable. Load SMS/PDF
  evidence from Activity Edit, correct a note, and confirm a linked core correction.
- Reverse a transfer with both balances: each report stays with its named account.
  Change account/type; verify an old report cannot be silently moved to another.
- Save/approve, use Edit or Undo, dismiss the notice, then find the latest action in
  More. Try repeated taps, a newer web edit, expiry, disconnect after Undo and an
  app restart. Offline queueing alone must not claim an online ledger save.
- Watch a large batch sync, network interruption and held rejection: accepted,
  waiting, delayed and correction counts must remain distinct. Unknown queue state
  must not show Ready. Compare last-success server/device-status timestamps.
- Compare Accounts' dated report and ledger-at-report difference; credit cards
  must not offer a cash-mismatch correction. Open the indicated account's balance
  check and quickly switch accounts to detect stale results.
- Check small width, enlarged text, TalkBack, Android Back, nested modal dismissal,
  phone restart/sign-in and logout/account switching with unsent work.

Automated React Native host tests verify state, requests and ownership guards;
they do not validate Android window layout, physical keyboard or TalkBack behavior.


## Compact form release 0.1.14

Use the same typecheck, JavaScript and Android module checks as above, then build
`assembleRelease` with JDK 17 and the existing private signing configuration.
Verify **0.1.14/code 15**, production API URL, embedded JavaScript and icon font,
and compare its signing certificate with `finance-mobile-0.1.13.apk`. Copy to
`dist/releases/finance-mobile-0.1.14.apk` and retain a SHA-256 checksum. Binaries
and local verification output remain ignored. Upgrade in place with the same key.

The automated gate is mobile typecheck, all **67 JavaScript tests** (including
compact-form/Quick Add retention regressions) and **38 Android module tests**.
Component host checks cover actual-container widths and enlarged text without
remounting controls, open searchable selectors, collapse/expand, exact seconds,
zero and dual transfer balances, linked consent and the submitted edit patch.
The 48-point picker affordances retain accessible calendar/clock labels and exact
text entry. No backend migration or queue reset is introduced.

On the installed phone, test SMS review, Quick Add, full entry and Activity Edit:

- Type amount, date/time, merchant, note and reference where offered. Expand and
  collapse details, reopen search sheets, refresh lookups and background/resume;
  verify the draft and keyboard remain usable. Do not reload/reset the app to
  test temporary draft retention.
- Check the narrowest screen and enlarged system text. Fields must stack, labels
  must wrap and picker buttons remain reachable. Wider screens may add columns.
- For transfers, verify both balances stay attached to their named accounts and
  linked correction consent remains visible. Switch to a non-transfer and check
  that the other account disappears; a layout change alone must alter no value.
- Trigger validation while optional details are closed. The error must remain
  visible and details must open without clearing other edits. Save once and
  verify the ledger, Edit/Undo and retained offline queues.
- Test TalkBack, Android Back, calendar/clock cancel, keyboard scrolling and the
  previous sign-in/SMS sync smoke checks, especially on OnePlus 12R / Android 16.

There is no attached physical device or configured emulator in the build
environment. Automated state/build checks do not establish physical IME,
TalkBack, native wrapping or end-to-end SMS acceptance behavior.

## Balance and activity release 0.1.15

Upgrade in place using the same signing key. Verify the package reports
**0.1.15/code 16** and its signing certificate matches the prior APK. Check
Home account cards with mixed currencies and inactive accounts; they show
individual ledger balances, never a cross-currency total. Check Activity at
small and large text sizes: debit, credit and transfer colors must retain their
type/account labels, and account-filtered transfers retain their direction.
In Debts & lending, verify owed-to-you and you-owe balances remain separate and
searching a name only filters the loaded list. Confirm Quick Add, review, SMS
sync and offline queues still behave as before.

## Profile and appearance release 0.1.16

Upgrade in place with the existing signing key. Verify **0.1.16/code 17** and
compare the signing certificate with the preceding APK. Open More → Profile &
appearance and check profile data loads, the username remains read-only, invalid
email reports an error, and saving a synthetic name/email updates the web view.
Switch System, Light and Dark, restart the app, and verify the selected appearance
persists while System follows the OS. Check Home, Activity, Review, Quick Add and
SMS capture in both modes on a physical phone, including enlarged text and
TalkBack. No financial data should change when only appearance changes.
