# Decisions And Questions

## Confirmed Decisions

- Phase 1 is for personal use.
- The design should keep a path open to future productization.
- Web app: Next.js.
- Backend: Django with Django REST Framework.
- Database: PostgreSQL.
- Mobile app: React Native Android.
- Currency: BDT only for now.
- Local testing first, online deployment later.
- AI categorization should come later.
- Basic deterministic rules should come first.
- Projects should remain separate.
- Payment methods need their own management area.
- Mobile app must let the user track SMS messages from selected sender numbers.
- Account balances can be calculated and manually reconciled.
- Missing balance differences should be shown.
- Debt/lend records are tracked separately, but money movement affects account
  balances when money actually changes hands.

## Monorepo vs Separate Repositories

Recommended starting point:

- Use one workspace folder with separate projects inside it.
- Keep each project independently runnable and documented.
- Keep dependencies separate.
- Use `finance-contracts` as the shared contract boundary.

Why this is best now:

- Faster early development.
- Easier cross-project changes while the API is still changing.
- Less operational overhead.
- Still respects the requirement that projects are separate.

When to split into separate repositories:

- Different teams or contributors own each part.
- Backend, web, and mobile need separate release cycles.
- Access permissions need to differ.
- CI/CD becomes complex.
- The project becomes a commercial product.

## Open Questions

1. Which SMS providers should be supported first: Bkash, Nagad, Rocket, City
   Bank, credit card SMS, or all of these from day one?
2. Do you want to import existing Excel history into the first version, or start
   fresh and import later?
3. Should the system support attachments, such as receipt photos, in phase 1?
4. Should categories be flat for now, or should they support parent/child
   hierarchy from the beginning?
5. Do you need PIN/biometric lock inside the mobile app?
6. Should the web app support multiple views per month like your spreadsheet
   tabs?
7. Should account balances be recalculated live every time, or should monthly
   summaries be cached after phase 1?
8. Should credit card purchases reduce available cash immediately, or only
   affect cash when the bill is paid?

## Suggested Answers For Phase 1

- Start with Bkash and one bank/card SMS parser first, then add more providers.
- Start fresh manually, then add Excel import once the schema is stable.
- Skip receipt attachments in phase 1.
- Use flat categories first.
- Add mobile PIN/biometric after login basics work.
- Build a monthly view that behaves like spreadsheet tabs, but do not clone the
  spreadsheet layout exactly.
- Calculate reports live first, cache later if performance requires it.
- Track credit card spending as card liability immediately, and cash movement
  only when the card bill is paid.

