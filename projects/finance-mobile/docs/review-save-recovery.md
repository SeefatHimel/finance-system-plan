# Immediate SMS review updates

Approving or rejecting a message from Home/Review removes it from the pending
list and count immediately after the final decision. Accepting a suggested
transfer also removes the matched pending SMS. Opening a rejection prompt or
transfer comparison does not save or remove anything. The next candidate opens
immediately and remains editable while the decision is saving.

## Failed or uncertain saves

The status card stays outside the workspace scroll, including when the final
candidate disappears. It announces checking/saving, failure or an unconfirmed
outcome. A confirmed success notice can be dismissed and expires after 15
seconds; failed/uncertain notices remain available.

- A definite validation/permission failure restores the affected rows, their
  original relative positions and the exact submitted drafts. Edits to other
  candidates remain untouched. Selection stays on the next candidate; **Review
  restored message** returns to the failed one. Editing a restored draft clears
  its old Retry action so a later save uses the corrected form.
- A timeout, 5xx, network failure or unreadable receipt can follow a committed
  write. The client checks each source's authenticated detail endpoint. If it is
  already confirmed/ignored, it leaves it out of the queue and offers the saved
  transaction when known. It does not claim that this device performed another
  device's action or offer an unrelated Undo.
- If the outcome remains uncertain, the entries stay hidden and the status card
  offers **Check save status** (GET only) and **Retry same decision**. There is no
  timer-based POST retry. Retry checks status first, then repeats the frozen
  original payload, candidate/match IDs and balance choices with the latest
  authentication token. It cannot write if that status check fails. A source
  resolved elsewhere is not written again; a still-pending counterpart is
  restored for a fresh decision.

Only one SMS review decision can be saving/unconfirmed at a time. Next-message
drafts and navigation remain available, while additional review writes and Undo
are disabled. Starting a decision clears the previous recovery notice/action;
own accepted confirmations/links refresh the existing Edit/Undo controls.
Rejection remains a separate explicit decision, including SMS redaction and
optional sender/provider exclusion. A status read proves whether the message is
pending/confirmed/ignored; it does not prove which device changed capture policy.

## State and retry safety

`src/review-mutation.ts` owns the decision, draft/position snapshots and a hidden-ID
overlay; it does not destructively replace the loaded source list. Request
versions invalidate older inbox refreshes. Settled IDs stay hidden until a fresh
authoritative refresh is accepted. That refresh can later expose a message
reopened through Undo. Counts subtract every affected pending source, including
a matched SMS outside the loaded window. Inbox refresh defers while a decision is
saving/uncertain so a response cannot partly replace that count baseline. Use
the explicit save-status controls to resolve an uncertain outcome.

Review uses offset pages, so removing server rows can shift subsequent offsets.
Load more waits for a complete refresh of the retained window after settlement.
A failed refresh keeps the overlay/drafts and offers refresh before loading more;
it cannot silently skip the next unseen row. A refresh during an uncertain save
does not authorize offset pagination.

The existing backend confirms/rejects under its user lock and database
transaction, requires a pending candidate and protects the original SMS identity.
Transfer linking revalidates target compatibility and reported-balance choices;
repeated links do not create a second movement. These guards are required because
a timed-out request can still finish while an explicit retry is being checked.
The client does not treat amount/reference equality as an idempotency key.

State is in memory for the signed-in backend/user. Logout destroys it and old
completions cannot change a new login, even for the same user. Restarting loses
these drafts/notices; the pending inbox is read from the server again. This does
not add a persistent financial mutation queue or change manual entry, saved-entry
editing, SMS upload retries, statement review, permissions or API contracts.
No migration or new native module is needed. Install a newly built APK to ship
the client change.

## Verification

From `projects/finance-mobile`:

```bash
npm run typecheck
npm run test:review
npm test
CI=1 npx expo export --platform android --output-dir dist/review-update-check
```

Tests exercise the real App, navigation, form and hooks with synthetic APIs and
native host mocks: immediate counts/selection, next-draft edits, rollback, paired
transfer failure, stale refreshes, uncertain receipts, explicit frozen retries,
token changes, logout/relogin and old Undo suppression. API-wrapper tests reject
unverifiable status responses. Existing API review/reference/transfer tests
verify server duplicate and retry protections using a disposable test database.

Before distributing an APK, test on a phone with slow/offline connectivity:

1. Approve from Home and Review; reject only after choosing a rejection scope.
   Check immediate counts, stable scroll and editing the next candidate.
2. Cause a validation failure, revisit the restored message and check all fields,
   including decimals, time, note, reference, account and balance. Check newer
   next-message edits remain. Edit the failed draft before resubmitting.
3. Accept a pending SMS pair only after reviewing the comparison. Check both
   disappear and both drafts return if the link fails.
4. Disconnect after sending. Check status, then explicitly retry; verify only one
   ledger movement exists. Repeat taps must not send parallel writes. Check the
   status card remains visible when the last message disappears.
5. Refresh during a save, load more after a settled action, use successful Undo,
   switch workspaces, foreground the app and logout/relogin during a slow save.
6. Check narrow screens, larger fonts, keyboard visibility, status announcements
   and wrapped actions with TalkBack. Metro/Hermes export is a bundle check, not
   proof of native layout or network behavior on a phone.
