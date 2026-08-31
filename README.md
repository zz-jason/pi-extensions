# pi-extensions

[![CI](https://github.com/zz-jason/pi-extensions/actions/workflows/ci.yml/badge.svg)](https://github.com/zz-jason/pi-extensions/actions/workflows/ci.yml)
[![CodeQL](https://github.com/zz-jason/pi-extensions/actions/workflows/codeql.yml/badge.svg)](https://github.com/zz-jason/pi-extensions/actions/workflows/codeql.yml)
[![Coverage](https://codecov.io/gh/zz-jason/pi-extensions/branch/main/graph/badge.svg)](https://codecov.io/gh/zz-jason/pi-extensions)
[![Release](https://img.shields.io/github/v/release/zz-jason/pi-extensions)](https://github.com/zz-jason/pi-extensions/releases/latest)
[![License](https://img.shields.io/github/license/zz-jason/pi-extensions)](LICENSE)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-FE5196?logo=conventionalcommits)](https://www.conventionalcommits.org/)

`pi-extensions` is a collection of practical extensions for [pi](https://github.com/earendil-works/pi-mono). The project packages small terminal workflow improvements that are useful across repositories but do not belong in pi core.

Pi is intentionally extensible: extensions can add tools, commands, lifecycle hooks, and custom TUI components without requiring changes to the main application. This repository provides a versioned, reviewable, and tested distribution channel for those additions, so users can install them without copying source files into their existing pi configuration.

## Installation

Pi can install this package globally for the current user or locally for a single project. Existing extensions continue to load alongside this package.

**Global installation**

Use the extensions in all pi projects for the current user:

```bash
pi install git:github.com/zz-jason/pi-extensions@v0.2.0
```

**Project installation**

Use the extensions only in the current project:

```bash
pi install -l git:github.com/zz-jason/pi-extensions@v0.2.0
```

Restart pi after installation, or run `/reload` in an existing session.

## Included Extensions

| Extension                                          | Description                                                                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`context-status`](extensions/context-status)      | Shows work dir, session name, model, thinking level, context window usage, and task elapsed time in a compact footer, with a centered context popup.             |
| [`auto-compact-70`](extensions/auto-compact-70.ts) | Compacts context after usage crosses 70%, provides `/compact70`, and resumes likely unfinished work without duplicating overflow recovery.                       |
| [`response-style`](extensions/response-style.ts)   | Appends focused response guidance so the agent acts directly, avoids routine tool narration, leads with conclusions, and keeps ordinary final responses concise. |

`context-status` replaces the complete default footer. Run `/info` to open a centered popup with the session name, working directory, Git branch, model, thinking level, context usage, task elapsed time, and changed files.

The popup uses pi's overlay API and closes with `Esc`, `Ctrl+C`, or `Enter`. Another extension that sets a custom footer may override `context-status` or be overridden by it.

`auto-compact-70` uses the active model's effective context window. Its continuation heuristic treats assistant turns ending in `toolUse` or `length` as potentially unfinished. Overflow recovery is left to pi's built-in retry path.

Licensed under the [MIT License](LICENSE).
