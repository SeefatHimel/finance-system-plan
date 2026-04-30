# Contributing

This project starts as a personal finance system, but the repository should stay
clean enough to become a product later.

## Working Rules

- Keep backend, web, mobile, infra, and contracts separated.
- Prefer small, reviewable changes.
- Update documentation when behavior or setup changes.
- Do not commit secrets, real SMS messages, real account numbers, or personal
  financial data.
- Keep API changes reflected in `projects/finance-contracts`.
- Run the narrowest useful verification before committing.

## Commit Style

Use clear, product-shaped commits:

```txt
docs: add finance system architecture
infra: add local postgres compose
api: add account model and endpoints
web: add transaction table shell
mobile: add android sms sender settings
contracts: document transaction endpoints
```

Recommended prefixes:

```txt
docs
infra
api
web
mobile
contracts
test
chore
```

## Branch Style

Use short branches:

```txt
feature/api-foundation
feature/web-dashboard
feature/mobile-sms-tracking
docs/project-roadmap
```

## Pull Request Checklist

- The change is scoped to one clear purpose.
- Documentation is updated when needed.
- No secrets or real financial data are committed.
- Relevant tests, lint, typecheck, or manual checks are listed.
- Screenshots are included for visible UI changes.

