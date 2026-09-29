# Native Android SMS Capture

Last updated: 2026-05-31

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
- Stores captured messages in native local storage first.
- The React Native app imports captured messages into the existing
  AsyncStorage-backed raw-message queue.
- Backend sync still goes through `POST /api/messages/import/`.

## Files

- `modules/finance-sms-capture/`
  - local Expo native module
  - declares `READ_SMS` and `RECEIVE_SMS`
  - registers an Android `SMS_RECEIVED` receiver
  - stores only sender-matched SMS messages
- `App.tsx`
  - requests SMS permission on Android
  - syncs enabled sender rules to the native module
  - imports captured native messages into the raw SMS queue

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
6. Tap `Sync Native Sender Rules` when changing existing toggles. Newly created
   mobile rules are enabled and synced automatically.
7. Choose `New only` for an incremental scan, or `Import history` and enter a
   date range. History scans can optionally refresh previous imports so pending
   review candidates use the latest parser. Confirmed transactions are not
   rewritten.
8. Tap the scan button. Matching messages are queued before upload; processed
   fingerprints remain skipped unless refresh is enabled.
9. Review imported candidates in the review inbox and confirm or ignore them.

Debug Android builds also show a two-step `Clear SMS test data` action. It
clears local captured/processed fingerprints, the local raw queue, and the
signed-in user's backend SMS candidates and SMS-created transactions. The API
returns `404` for this operation when `DJANGO_DEBUG=false`.

## Privacy Guardrails

- Do not enable broad sender patterns unless they are necessary.
- Do not upload untracked sender messages.
- Sender discovery reads only sender addresses/names, timestamps, and counts;
  raw bodies are read only later for explicitly tracked senders during a scan.
- Keep raw SMS deletion/redaction available in the backend.
- Test with anonymized or personal test messages first.
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
