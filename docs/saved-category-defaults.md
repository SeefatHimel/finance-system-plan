# Saved categories for pending reviews

Choose a category while reviewing a transaction and record it. Select **Save for
similar SMS** in the success message. Similar pending entries immediately receive
the compatible saved category as their review default; no parser rerun is needed.
An already edited or explicitly cleared local category is retained. Confirmed
transactions and stored pending SMS are not rewritten.

## Pathao rides and Food

Pathao Car, Bike, CNG and explicit Ride/Rides wording share one **rides** category
choice. Pathao Food has its own choice. Rules are specific to the user and wallet
account. They can be shared across trusted Pathao sender rules for that account.
Unknown or mixed service wording does not inherit either category. A card funding
or transfer message cannot teach a rides/Food category.

For a rule saved before this feature, re-save the category once from a confirmed
ride, and separately from a confirmed Food payment. Earlier sender-wide purchase
rules lack service provenance and cannot safely be assumed to mean Transport.
They remain stored, but do not supply Pathao purchase review categories. Existing
statement-specific mappings retain their exact-pattern fallback.

SMS and PDF review share the scoped choice in existing `StatementMapping`
storage. Saving a statement category with **Remember these choices** also makes
it available to similar SMS. Category grouping does not copy a ride's private
note or replace a Bike/CNG merchant with a Car label. Explicitly replacing a saved
SMS category requires the existing conflict/replace confirmation.

## Review defaults and precedence

- Stored source classification, amounts, directions and original evidence remain
  unchanged. `suggested_category` is a read-only response field.
- Explicit local choices and saved statement categories take precedence over
  inferred defaults. Only active compatible categories owned by the user qualify.
- Opening a pending combined review or statement editor prefills its compatible
  saved category. Saving a rule while a pair is open refreshes only an untouched
  category; late responses cannot replace manual edits.
- Ordinary sender/message-type categories are resolved for existing pending SMS
  too. This does not automatically reclassify types or choose transfer accounts.
- An explicit category or null in a confirmation request is respected. If absent,
  the backend uses its compatible current review default.

`suggested_category: null` intentionally supplies no category, including when a
legacy broad Pathao choice would be unsafe. If an older API omits the field,
clients retain their parsed-category fallback. Native mobile new-draft support
requires shipping the updated mobile build; already open native drafts retain
their edits.

The category resolver batches rule reads per user/serializer page. It does not
query history or write during reads. There are no new tables or migrations.

## Verification

Synthetic backend tests cover pending hints, rides/Food isolation, replacement,
manual confirmation, ownership/account scope, inactive categories, shared PDF
learning, combined review and constant query counts. Frontend unit tests cover
legacy fallback, null suppression and manual precedence. Playwright checks both
desktop and mobile web: confirm a ride, save its rule, observe a pending ride
update without losing its note, leave Food uncategorized, open its PDF/SMS pair
with the category selected, and retain a manual category through another save.

```sh
# projects/finance-api, with a disposable PostgreSQL DATABASE_URL
python manage.py test apps.messages.test_category_suggestions --keepdb --noinput

# projects/finance-web, with the documented synthetic browser fixture running
FINANCE_E2E_PYTHON=/path/to/python npm run test:e2e -- saved-category-defaults.spec.ts
```

The browser fixture generator uses the existing synthetic in-memory Pathao PDF
fixture and requires the API development dependencies. No real SMS, identifiers
or financial PDFs are committed.
