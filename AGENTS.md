# Repository Instructions

## Branch Naming And Git Flow

- Use Git Flow branch names based on the purpose of the work, never the tool or agent performing it.
- `main`: production releases. Do not develop features directly on this branch.
- `develop`: integration branch, when present.
- `feature/<slug>`: features, routine bug fixes, refactors, tests, and maintenance. Branch from `develop` when present; otherwise use `main`. Merge back into the same integration branch through review.
- `release/<version>`: release preparation. Branch from `develop`, then merge into `main` and back into `develop`.
- `hotfix/<slug>`: urgent production fixes. Branch from `main`, then merge into `main` and the integration branch.
- Use lowercase ASCII kebab-case for descriptive slugs, such as `feature/overlay-stability` or `hotfix/startup-crash`.
- Never create or use branches starting with `claude/`, `codex/`, or `cursor/`. This applies to every contributor and automation.
- Check the current branch before editing, committing, or pushing. Rename a noncompliant task branch without resetting files or rewriting commits.
- Do not rename, delete, or force-push remote branches without explicit user authorization.
- Follow this repository's naming rules instead of agent-specific default branch prefixes.
