# Privacy And Security

This system stores sensitive financial data and SMS content. Privacy decisions
should be made early, even while the app is personal-only.

## Data That Must Be Protected

- Transaction history
- Account names and balances
- SMS message bodies
- Phone numbers and sender identifiers
- Counterparty names
- Debt records
- Authentication tokens

## Repository Safety

Never commit:

- Real `.env` files
- Real SMS bodies
- Real bank account/card numbers
- Real transaction exports
- Database dumps with personal data
- Access tokens or API keys

## Product Safety Defaults

- Store only SMS messages from sender rules the user enabled.
- Keep ignored sender messages out of backend storage.
- Let each user exclude an entire provider or supported non-transaction message
  kind. OTP/security messages are excluded by default.
- For an excluded message, keep only the sender/time metadata and deterministic
  body hash needed to prevent repeat imports; replace the body before database
  storage and do not create a review candidate.
- Do not scan or upload the whole SMS inbox. Automatic capture, if enabled for
  a personal APK, should only process messages whose sender matches an active
  sender rule and whose body looks transaction-related.
- Allow raw message redaction. Redaction should remove the original SMS body
  and device message id while preserving parsed ledger evidence, duplicate
  hashes, and audit links.
- Rejection should record the reason and allow the user to redact the body,
  disable the matched sender rule, or exclude the whole provider without a
  second workflow.
- Use HTTPS in production.
- Scope every backend query by user.
- Keep audit timestamps on financial records.
- Keep production web refresh tokens in HTTP-only cookies rather than browser
  `localStorage`.
- Add export and backup features before relying on the system long term.

See `docs/auth-token-storage-plan.md` for the web, mobile, and backend token
hardening plan.

## Android SMS Notes

SMS permission is sensitive. The mobile app should clearly explain why SMS
access is needed and should only process messages from user-approved senders.

For Play Store distribution later, SMS permissions may require policy review.
For personal APK use, development is simpler, but the app should still be built
with product-level privacy behavior.

Current decision: keep Expo Go as the manual-import/testing path and use the
local native Android SMS module only for custom dev client or personal APK
builds. See `docs/mobile-sms-permission-decision.md`.
