# Agent Instructions

These instructions apply to the whole repository.

## Project Shape

- Keep the projects separate:
  - `projects/finance-api`
  - `projects/finance-web`
  - `projects/finance-mobile`
  - `projects/finance-infra`
  - `projects/finance-contracts`
- Prefer small, reviewable changes.
- Update project-specific documentation whenever setup, behavior, commands, or
  architecture changes.
- Do not commit secrets, real financial data, real SMS content, database dumps,
  or personal account identifiers.

## Q&A Maintenance

The `qa/` folder is part of the project deliverable and interview preparation.
When adding or changing meaningful behavior, update the relevant Q&A file.

Update Q&A when changes affect:

- Architecture or project boundaries.
- Backend API behavior, models, auth, permissions, or reporting.
- Web app workflows, auth, data fetching, UI decisions, or limitations.
- Mobile app SMS behavior, sync, permissions, or offline handling.
- Infrastructure, deployment, environments, or privacy/security.
- API contracts or integration assumptions.

Use these files:

- `qa/global.md` for product-wide and architecture questions.
- `qa/backend-api.md` for Django/API questions.
- `qa/web-app.md` for Next.js/web workflow questions.
- `qa/mobile-app.md` for React Native/SMS questions.
- `qa/infrastructure.md` for local/dev/deployment questions.
- `qa/api-contracts.md` for API boundary questions.
- `qa/interview-pitch.md` for concise pitch updates.

Do not over-update Q&A for tiny internal refactors that do not change what an
interviewer or maintainer needs to understand.

## Verification

- Run the narrowest practical check for the changed project.
- If dependencies are not installed, run syntax or configuration checks that do
  not require installation and state what remains unchecked.
- Keep `docs/local-setup.md` accurate as commands evolve.

## Git

- Check `git status --short` before and after changes.
- Do not stage, commit, or push unless explicitly asked.
- Suggested commit messages should follow `CONTRIBUTING.md`.

