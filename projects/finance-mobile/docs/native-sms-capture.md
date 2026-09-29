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
2. Load payment methods and sender rules.
3. Enable only the sender rules you trust, such as `bKash`, `EBL`, City Bank,
   or Pathao Pay.
4. Tap `Request Android SMS Permission`.
5. Tap `Sync Native Sender Rules`.
6. Tap `Scan phone & sync` in the modern SMS automation screen. The first run
   can backfill matching messages already in the inbox; later runs scan again
   but skip deterministic fingerprints already processed.
7. Review imported candidates in the review inbox and confirm or ignore them.

## Privacy Guardrails

- Do not enable broad sender patterns unless they are necessary.
- Do not upload untracked sender messages.
- Keep raw SMS deletion/redaction available in the backend.
- Test with anonymized or personal test messages first.
- Public distribution needs policy/legal review before requesting SMS
  permissions from real users.

## Troubleshooting

- If permission says unavailable, rebuild with `npx expo run:android`; Expo Go
  is not enough.
- If no messages import, confirm at least one sender rule is enabled and synced.
- A scan checks up to 5,000 recent inbox rows and captures up to 500 new matches
  per run. Run it again if a very large historical inbox has more matches.
- If a bank sender uses mixed case or a short code, add the backend sender rule
  exactly as it appears on the phone or use a conservative `contains` rule.
- If the API is unreachable on a physical phone, use your computer's LAN IP in
  `EXPO_PUBLIC_API_BASE_URL`, not `localhost`.
