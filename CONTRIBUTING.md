# Contributing to react-file-browser

Thanks for your interest in improving react-file-browser. This guide covers the local setup, the
project conventions, and how changes get released.

## Prerequisites

- [Bun](https://bun.sh) (this repo uses Bun as the package manager and runner, not npm/yarn/pnpm)
- Node.js >= 20

## Getting started

```bash
git clone https://github.com/harryy2510/react-file-browser.git
cd react-file-browser
bun install
bun run hooks:install   # installs the lefthook git hooks
```

Run the demo app locally:

```bash
bun run dev
```

## Project layout

- `src/` — the published library (components, headless hook, adapters, transfers, theme).
- `demo/` — the showcase app deployed to GitHub Pages. Not published to npm.
- `tests/` — Vitest unit tests (jsdom).
- Architecture and design references for contributors live in the repo's internal docs.

## Development workflow

1. Create a branch off `main`.
2. Make your change with a test. This project practices test-driven development for features and
   bug fixes.
3. Run the full check locally before pushing:

   ```bash
   bun run validate
   ```

   `validate` runs formatting check (oxfmt), type-aware lint (oxlint), unit tests, the library
   build, and the demo build.

4. Open a pull request against `main`.

## Coding conventions

- **Formatting**: `oxfmt`. Run `bun run format` to autofix.
- **Linting / type-check**: `oxlint --type-aware --type-check` (via `bun run lint`). There is no
  separate `tsc` step.
- **Imports**: use named React imports (`import { useState } from 'react'`). Do not default-import
  React.
- **File names**: kebab-case, lowercase.
- The git hooks (lefthook) run oxfmt and oxlint on staged files automatically. Do not bypass hooks.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/) and enforces them
with commitlint. Releases are automated with semantic-release based on your commit types:

- `fix:` → patch release
- `feat:` → minor release
- `feat!:` / `fix!:` / a `BREAKING CHANGE:` footer → major release
- `docs:`, `chore:`, `test:`, `refactor:`, etc. → no release

Example:

```
feat: add drag-to-reorder support to the grid view
```

## Releasing

Releases run automatically from `main` via semantic-release. Maintainers do not tag or publish by
hand. Merging a PR with a releasable commit type publishes to npm and updates the changelog.

## Reporting bugs and requesting features

Use the [issue tracker](https://github.com/harryy2510/react-file-browser/issues) and the provided
templates. For security issues, see [SECURITY.md](SECURITY.md) instead of opening a public issue.
