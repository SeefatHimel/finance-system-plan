# Expanding original source evidence

SMS review keeps a three-line preview and adds **Expand SMS / Collapse SMS**.
Expanding shows the complete selectable body inline. **View full SMS** still
opens the dedicated scrollable reader for small screens; closing it returns to
the same review draft and expansion state.

Activity's transaction editor groups evidence under **Original SMS (N)** and
**Original statement rows (N)**. Opening a section reveals every source's full
text, without another nested expansion. Sections start collapsed to keep the
form compact. Their children stay mounted when closed, so reading evidence does
not remount inputs, clear typed fields or reset linked-correction consent.
Expanding does not save, reparse, link or mark the evidence reviewed.

Statement cards show the immutable extracted description/text and extracted
date/time, exact amount, direction, signed fee and reported balance, including
page/row when supplied. They do not substitute the reviewed statement draft or
ledger values as the original. Missing extraction is explicitly unavailable.
The current API supplies the extracted row description; an additional raw-text
field is displayed if supplied. This is a row viewer, not an entire PDF viewer
or a new native statement-import workflow.

Redacted SMS stays unavailable in both inline text and the full reader, even
if a retained response has a nonempty body alongside redaction metadata. No
restoration is attempted by expansion. Existing SMS retention and explicit
history-restoration rules still apply.

The saved-entry editor continues loading its record independently of evidence.
Late evidence and token changes must not replace unsaved edits. Navigation keeps
the mounted SMS review and its expansion state for the login. These are in-memory
views; closing the saved-entry editor, switching candidate, logout or restart
does not promise persistent expansion/draft recovery.

## Checks

From `projects/finance-mobile`:

```bash
npm run typecheck
node --test tests/mobile-source-evidence.test.cjs
npm test
```

Native host tests cover full inline text, the full reader, collapse/reopen,
navigation, late evidence, retained exact edits and consent, responsive/enlarged
text rerenders, the submitted PATCH, missing extraction and live redaction.
They do not prove physical keyboard, TalkBack, scrolling or window geometry.

On a phone, expand a long SMS while editing, open/close its reader, switch tabs
and return. Open both evidence sections in Activity Edit and check every original
is readable/selectable. Collapse/reopen with the keyboard active and enlarged
text, confirm the draft and correction consent remain, then save once. Check
zero balances, multiple sources, missing extraction and redacted SMS. Verify
TalkBack announces expansion and skips collapsed contents. See the
[signed release guide](signed-android-release.md).

Combined web review follows the same reading flow: opening **Compare original
sources and parsed values** reveals the original SMS and PDF-row text initially
expanded. Either original can still be collapsed independently. The web draft,
balance decisions and required confirmations stay mounted and unchanged.

No API contract, migration, dependency, permission or financial-write behavior
changes. Mobile changes require installing the newly built APK.
