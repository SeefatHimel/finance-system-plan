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
- Captures only messages whose sender matches enabled backend sender rules.
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
6. Wait for a matching SMS to arrive on the device.
7. Tap `Import Captured SMS`.
8. Review the imported item in `Queued Messages`.
9. Tap `Sync Queued Messages` to send it to the backend import endpoint.
10. Use `SMS Review Inbox` to confirm or ignore parser candidates.

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
- If a bank sender uses mixed case or a short code, add the backend sender rule
  exactly as it appears on the phone or use a conservative `contains` rule.
- If the API is unreachable on a physical phone, use your computer's LAN IP in
  `EXPO_PUBLIC_API_BASE_URL`, not `localhost`.
