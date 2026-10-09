# Native Android SMS Capture

Last updated: 2026-10-09

## Scope

This is a personal-APK/native Android path for importing finance SMS messages
from user-enabled sender rules. It is not intended for public Play Store release
until the app has a full privacy policy, consent copy, and SMS permission policy
review.

The implementation is intentionally narrow:

- Android only.
- Requires a custom Android dev client or APK.
- Captures new messages and can scan existing inbox history after permission is
  granted, but keeps only messages whose sender matches enabled backend rules.
- Stores deterministic fingerprints for matched messages so repeated scans
  skip messages that were already processed.
- Encrypts captured message bodies and the raw-message retry queue with an
  Android Keystore key; Android application backup is disabled.
- Schedules new-message uploads with WorkManager when a network is available.
- Refreshes an expired access token once in the worker and retains API-rejected
  messages on-device for explicit retry instead of discarding them.
- Backend sync still goes through `POST /api/messages/import/`, which rejects
  any sender that no longer matches an active rule for the signed-in user.

## Files

- `modules/finance-sms-capture/`
  - local Expo native module
  - declares `READ_SMS` and `RECEIVE_SMS`
  - registers an Android `SMS_RECEIVED` receiver
  - stores only sender-matched SMS messages
  - persists sensitive payloads encrypted and runs constrained background sync
- `App.tsx`
  - requests SMS permission on Android
  - syncs enabled sender rules to the native module
  - scans directly into the native encrypted queue and schedules its worker

## Fresh Device Setup

From `projects/finance-mobile` on a machine with Android Studio and a connected
Android phone or emulator:

```bash
npm install
cp .env.example .env
```

For a physical Android device, set the API URL to your computer's LAN IP:

```txt
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:8000
```

Generate the native Android project and run it:

```bash
npx expo prebuild --platform android
npx expo run:android --device
```

Expo Go cannot load this module. Use the generated custom dev client or a
debug/release APK built from the generated Android project.

## Phone Workflow

1. Sign in.
2. Load payment methods and existing sender rules.
3. To add a rule from the phone, tap `Find SMS senders on phone`, search the
   distinct sender names, choose one, select its destination account and
   provider, then tap `Add & track sender`. The picker reads sender metadata and
   counts only; it does not display SMS bodies.
4. Enable only the sender rules you trust, such as `bKash`, `EBL`, City Bank,
   or Pathao Pay.
5. Tap `Request Android SMS Permission`.
6. Existing toggles and newly created rules are synced to native capture
   immediately. Inactive backend rules cannot be enabled locally.
7. Choose `New only` for an incremental scan, or `Import history` and enter a
   date range. History scans can optionally refresh previous imports so pending
   review candidates use the latest parser. Confirmed transactions are not
   rewritten.
8. Tap the scan button. Matching messages are queued before upload; processed
   fingerprints remain skipped unless refresh is enabled.
9. Review imported candidates in the review inbox and confirm or ignore them.
   Before confirmation, every required ledger field can be corrected, including
   amount, date, type, source/destination accounts, payment method, category,
   counterparty, reference, and note.

Debug Android builds also show a two-step `Clear SMS test data` action. It
clears local captured/processed fingerprints, the local raw queue, and the
signed-in user's backend SMS candidates and SMS-created transactions. The API
returns `404` for this operation when `DJANGO_DEBUG=false`.

## Queue ownership and progress

In installed Android builds, both live captures and history scans are uploaded
by the same native WorkManager consumer. The previous encrypted app retry queue
is merged into the native queue when sync is configured or requested. Migration
commits both encrypted values together, keeps backend device-message IDs and
reprocessing choices, and deduplicates records already captured natively. An
upgrade retains pending messages; do not uninstall or clear application data.

Each successful response is acknowledged immediately. Work is limited to 1,000
eligible records or approximately four minutes per run, with continuation for
remaining eligible records. Connectivity failures, HTTP 408/429 and server
errors use WorkManager retry. Other rejected records remain encrypted and are
held for explicit retry without blocking later records. `Retry background sync`
releases that hold. Authentication failures require signing in again. Native
HTTP requests have 15-second connect and 20-second read timeouts; foreground API
and authentication requests have a 25-second timeout covering the response body.

The header, home and scan sections use the native pending count. The activity
summary labels the separate manual transaction queue explicitly. While signed
in and foregrounded, the UI reads **local native status** every 1.5 seconds and
on app resume. This does not poll backend lists: review and activity reload at
sync completion. Background work continues independently of the UI. Android
scheduling and connectivity still govern when uploads run.

`SafeAreaProvider` and the safe-area view keep the header and bottom tabs outside
system bars. Text in horizontal cards has a bounded, shrinking flex column;
labels can wrap, and the header title can shrink on narrow displays.

Verification commands from `projects/finance-mobile`:

```bash
npm run typecheck
npm run test:network
npm run test:gestures
cd android
./gradlew :finance-sms-capture:testDebugUnitTest :app:compileDebugKotlin
```

The native tests cover the 440-record migration, repeat migration, duplicate
capture, reprocessing choices, malformed migration records and retryable HTTP
responses. A physical phone is still required for status-bar/text scaling and
closed-app SMS upload validation.

## Privacy Guardrails

- Do not enable broad sender patterns unless they are necessary.
- Do not upload untracked sender messages.
- The API repeats the active-rule check, so a modified client cannot upload an
  arbitrary sender's SMS body.
- Sender discovery reads only sender addresses/names, timestamps, and counts;
  raw bodies are read only later for explicitly tracked senders during a scan.
- Keep raw SMS deletion/redaction available in the backend.
- Test with anonymized or personal test messages first.
- Explicit logout revokes the refresh token, then clears the native sync
  session, local rules, captured SMS payloads, processed-message memory, and
  encrypted raw queue.
- Public distribution needs policy/legal review before requesting SMS
  permissions from real users.

## Troubleshooting

- If permission says unavailable, rebuild with `npx expo run:android`; Expo Go
  is not enough.
- If no messages import, confirm at least one sender rule is enabled and synced.
- A scan checks up to 5,000 inbox rows inside the selected range and captures
  up to 500 matches per run. Narrow the dates or run it again for a very large
  historical inbox.
- If a bank sender uses mixed case or a short code, add the backend sender rule
  exactly as it appears on the phone or use a conservative `contains` rule.
- If the API is unreachable on a physical phone, use your computer's LAN IP in
  `EXPO_PUBLIC_API_BASE_URL`, not `localhost`.
