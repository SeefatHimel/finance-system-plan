# Git Workflow

The repository should tell a clear project story on GitHub. That means commits
should be small, named clearly, and pushed after useful milestones.

## Recommended Flow

```txt
main
  stable documentation and working milestones

feature/*
  focused implementation work
```

For early solo development, working directly on `main` is acceptable for
documentation and setup. Once real app code starts, use feature branches.

## Milestone Commit Plan

Suggested first commits:

1. `docs: document finance system architecture`
2. `infra: add local postgres development setup`
3. `api: scaffold django backend`
4. `contracts: add initial openapi contract`
5. `web: scaffold next app`
6. `mobile: scaffold react native android app`
7. `api: add accounts categories and transactions`
8. `web: add manual transaction workflow`
9. `mobile: add quick transaction entry`
10. `mobile: add sms sender tracking settings`

## Before Pushing

Run:

```bash
git status --short
```

Check:

- No real personal data.
- No `.env` files.
- No generated dependency folders.
- README still explains what the project is.
- The commit message describes the outcome, not just the files changed.

## GitHub Presentation

The repository should show:

- A clear root README.
- Architecture and roadmap docs.
- Per-project READMEs.
- Setup instructions.
- Screenshots later, once UI exists.
- Issue and PR templates.

