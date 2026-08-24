# Contributing

Thank you for improving `pi-extensions`.

## Development setup

Requirements:

- Node.js 22.19.0 or newer
- npm 10 or newer
- pi 0.84.2 or newer for manual testing

Install dependencies and run the complete validation suite:

```bash
npm ci
npm run validate
```

Load the extension in pi during development:

```bash
pi -e ./extensions/context-status/index.ts
```

Place a single-file extension directly under `extensions/`. Place a multi-file extension in its own directory with an `index.ts` entry point, and add that entry point to the `pi.extensions` manifest in `package.json`.

## Commit messages

Every commit and pull request title must follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>[optional scope]: <description>
```

Common types are `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`, and `revert`.

Examples:

```text
feat(context-status): show the active Git branch
fix(context-status): stop the timer after cancellation
docs: clarify project-level installation
ci: add dependency review
```

Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.

Validate the latest commit locally with:

```bash
git log -1 --pretty=%B | npm run commitlint
```

## Pull requests

1. Create a focused branch from `main`.
2. Add or update tests for behavior changes.
3. Run `npm run validate`.
4. Open a pull request with a Conventional Commit title.
5. Resolve all review conversations and required CI checks.

Do not include credentials, proxy URLs, prompts, session content, or other sensitive data in code, fixtures, logs, or screenshots.
