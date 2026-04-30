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
- Allow raw message deletion later.
- Use HTTPS in production.
- Scope every backend query by user.
- Keep audit timestamps on financial records.
- Add export and backup features before relying on the system long term.

## Android SMS Notes

SMS permission is sensitive. The mobile app should clearly explain why SMS
access is needed and should only process messages from user-approved senders.

For Play Store distribution later, SMS permissions may require policy review.
For personal APK use, development is simpler, but the app should still be built
with product-level privacy behavior.

