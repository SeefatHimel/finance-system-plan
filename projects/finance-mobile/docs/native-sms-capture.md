# Native Android SMS Capture

Last updated: 2026-10-12

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

## Native command results and sign-in

Session initialization, background-sync configuration and enqueue commands use
`smsBridgeCommand` to discard internal return values and resolve as Unit, matching
the JavaScript `Promise<void>` contract. Expo converts Unit to null; it cannot
serialize an arbitrary Kotlin `SmsSession`. Storage and scheduler failures still
reject the promise. Session getters and token refresh use explicit maps.

Release 0.1.9 (Android code 10) fixes the 0.1.8 sign-in rejection. Upgrade using
the existing signing key to retain data. Native release tests cover the installed
Expo converter, session persistence, scheduler result disposal and storage-error
propagation. Run `:finance-sms-capture:testReleaseUnitTest` before release assembly
and verify actual sign-in on a phone; a successful build alone cannot validate
this JavaScript/native boundary.

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

- If sign-in reports `Unknown type: class ...SmsSession`, install release 0.1.9
  or later over the existing app. This is a native command-result bug in 0.1.8.

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

## Recovering a stalled SMS queue (0.1.6)

A DNS failure such as Unable to resolve host means the request never reached the
API. The queue count therefore remains unchanged; only acknowledged successful
imports remove saved SMS. An API health check from another device cannot prove
the phone's DNS/network is working. Try another connection and check Private DNS
or VPN settings if resolution failures persist. Keep queued data intact.

Ordinary triggers now coalesce unfinished work instead of accumulating jobs
behind backoff. One successor covers new captures and the four-minute limit.
Manual Retry replaces a waiting/backoff chain, but never cancels an active
upload. Automatic recovery does the same on app resume and a transition to a
validated default network, without releasing rejected records. Manual Retry
continues to release their hold. Background WorkManager retries use an explicit
30-second linear base; Android constraints and power management still determine
when work can start. The native receiver holds its asynchronous broadcast result
until scheduling completes; scheduler lookups do not block its main thread.

The native status includes the actual worker-running flag, scheduled retry
metadata and a failure kind. The UI shows amber Waiting for network/server errors
and reserves Attention for authentication, rejected records or other failures.
The capture screen distinguishes saved, uploadable and correction counts, and
shows the earliest retry time when known. The local 1.5-second status reader
applies native counts even if a legacy queue read fails. It does not poll APIs.

Run `npm run test:sms-sync` and the native checks above. Unit tests cover delayed
chain replacement, repeated capture coalescing, active-worker preservation and
DNS/timeout/server presentation; a physical phone is still required to verify
Android connectivity and power-management behavior end to end.

References: [WorkManager request/backoff configuration](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work)
and [unique work policies](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/manage-work).

## Upload investigation and release 0.1.7

The source investigation found failure paths independent of any Wi-Fi diagnosis:

- The worker held one credential snapshot for a run while foreground APIs could
  rotate and blacklist its refresh token. A local Django experiment reproduced
  successful foreground rotation followed by HTTP 401 for the old worker token.
- A retryable error on the first message exited the run before later messages.
  Every new run selected that same message first. A real HTTP fault fixture
  with 552 records now verifies that one HTTP 500 leaves that record retained
  while the other 551 upload.
- HttpURLConnection bounded idle reads but not a complete response. A trickling
  body could keep the worker waiting. The new OkHttp transport has a 25-second
  whole-call deadline, including a bounded wait for DNS/response completion;
  worker cancellation interrupts the wait and cancels the call.
- Expo's default AsyncFunction queue is a single HandlerThread. Historical scans
  and blocking waits could delay status reads. Those operations now use an IO
  scope, while local progress reads remain independent.

`SmsUploadEngine` is the production loop, tested with MockWebServer and synthetic
queue/session stores. Acknowledgement occurs only after a successful response
and a same-user check. HTTP 408/500/502-type per-record failures get a 30-second
hold so later eligible records proceed. Three consecutive transient server
failures stop the run; HTTP 429/503 and transport failures stop immediately to
avoid hammering an unavailable service. Rejected 4xx records stay held. Delayed
records remain counted and keep retry work scheduled. Capture/worker budgets
still limit each run; the budget uses a monotonic clock.

`SmsSessionCoordinator` owns native credentials after explicit login. Foreground
API recovery and the worker share one refresh flight, use current credentials
before refreshing and cannot overwrite a newer rotation with an old React
snapshot. A new login wins over an older in-flight refresh. User changes cannot
acknowledge another user's queue; the API still verifies JWT authentication.
The JavaScript SecureStore session is a foreground snapshot, not an independent
refresh owner in the installed Android app. Expo Go retains the existing
JavaScript refresh path.

Encrypted read failures now retain ciphertext and report a storage error instead
of deleting the key's value and returning an empty queue. Storage diagnostics
use the last known count, or Count unavailable when no count can be established.

Show sync diagnostics includes an explicit allowlist: app version, foreground
and native API hostnames, stage, HTTP/error class, counts, worker/retry metadata
and activity timestamp. It excludes SMS bodies, sender names, record identifiers,
users and tokens. The user can copy or share it; diagnostics are not uploaded
in the background. A DNS exception records a request failure, not a diagnosis
of Wi-Fi/router settings. Exact phone behavior still requires that device's
operational diagnostics or logs; simulated HTTP tests do not prove its cause.

### Queue presentation in 0.1.13

The native delayed count excludes held/rejected records so UI correction and
delay counts are disjoint. Pending counts still include all saved unacknowledged
messages; uploads, receipts and retry keys are unchanged. Capture shows accepted
acknowledgements for the current/last run, waiting, delayed and correction counts,
plus last-success time reported by the existing device-status API (which may
include this user's other devices). Unknown/unreadable state is unavailable, not
an empty queue. Health success only confirms server reachability. Do not infer a
posted ledger transaction from a successful raw-SMS acknowledgement.
