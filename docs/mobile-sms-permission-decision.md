# Mobile SMS Permission Decision

Last updated: 2026-05-31

## Decision

Keep Expo Go as the manual-import/testing path. Use `READ_SMS` and
`RECEIVE_SMS` only in generated Android builds that include the local native SMS
module for custom dev client or personal APK use.

The first native Android implementation path is now scaffolded for custom dev
client or personal APK builds:

- `projects/finance-mobile/modules/finance-sms-capture/` adds the local Android
  SMS receiver and native module.
- `projects/finance-mobile/docs/native-sms-capture.md` documents fresh-device
  setup and phone workflow.

For production distribution, keep a separate release decision:

- For personal APK use, move to a bare React Native or Expo prebuild/custom dev
  client path and implement the smallest Android native module needed for
  sender-scoped SMS import.
- For public Google Play distribution, avoid broad SMS permissions unless the
  app clearly qualifies under Google Play's SMS permission policy. If it does
  not qualify, keep SMS import manual or use a non-SMS-permission alternative.

## Why

SMS content is personal and sensitive financial data. Android exposes SMS
permissions such as `READ_SMS` and `RECEIVE_SMS`, but Google Play restricts SMS
and Call Log permission use to narrow cases. Adding these permissions too early
would create policy, privacy, and architecture risk before the product flow is
ready.

The current backend and UI already support the safer parts of the workflow:

- User-managed sender rules.
- Raw message import endpoint.
- Duplicate detection.
- Parsed candidate review inbox.
- Mobile sender-selection scaffold.

That lets us finish account mapping, review, and sync behavior before native SMS
capture exists.

## Implementation Direction

If personal APK SMS automation is still required:

1. Use Expo prebuild/custom dev client or bare React Native. Expo Go cannot
   load the native module.
2. Keep Android manifest permissions only in the native app target that needs
   them.
3. Request permission at the moment the user enables SMS tracking, not at app
   launch.
4. Explain clearly that only user-enabled sender rules are processed.
5. Store raw messages locally first, then sync through `POST /api/messages/import/`.
6. Never upload messages from senders that the user did not enable.
7. Keep a manual import fallback for devices or distributions where SMS access
   is unavailable.

## Non-Goals For Now

- Reading the full SMS inbox.
- Uploading native-captured messages before the user imports them into the
  review/sync queue.
- Adding third-party SMS dependencies before the custom native module is proven.
- Optimizing for Play Store approval before the app has a production privacy
  posture.

## References

- Android permission constants include SMS permissions such as `READ_SMS` and
  `RECEIVE_SMS`: https://developer.android.com/reference/android/Manifest.permission
- Android data-use guidance notes that Google Play restricts some SMS
  permissions unless requirements are met:
  https://developer.android.com/guide/topics/data/collect-share
- Google Play treats SMS and Call Log permissions as personal and sensitive and
  restricts their use:
  https://support.google.com/googleplay/android-developer/answer/9888170
- Google Play services SMS Retriever/User Consent APIs are useful for app-directed
  verification SMS, but they do not solve bank/provider transaction SMS inbox
  import:
  https://developers.google.com/android/reference/com/google/android/gms/auth/api/phone/package-summary
