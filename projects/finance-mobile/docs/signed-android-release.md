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
in `android/app/build.gradle`. Keep the Expo `version` in `app.json` aligned.
Android requires a larger `versionCode` for every upgrade.

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
