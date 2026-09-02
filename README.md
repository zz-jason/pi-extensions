# pi-extensions

[![CI](https://github.com/zz-jason/pi-extensions/actions/workflows/ci.yml/badge.svg)](https://github.com/zz-jason/pi-extensions/actions/workflows/ci.yml) [![CodeQL](https://github.com/zz-jason/pi-extensions/actions/workflows/codeql.yml/badge.svg)](https://github.com/zz-jason/pi-extensions/actions/workflows/codeql.yml) [![Coverage](https://codecov.io/gh/zz-jason/pi-extensions/branch/main/graph/badge.svg)](https://codecov.io/gh/zz-jason/pi-extensions) [![License](https://img.shields.io/github/license/zz-jason/pi-extensions)](LICENSE)

Practical extensions for the [pi coding agent](https://github.com/earendil-works/pi-mono).

`pi-extensions` packages small, focused workflow improvements that are useful across repositories but do not belong in pi core.

## Highlights

- Compact context footer with session, model, thinking, and usage status.
- Rich `/info` popup for session, Git, model, and runtime context.
- `/show-agents` popup for the recursive macOS/Linux coding-agent process tree.
- Automatic context compaction after usage crosses 70%.
- Concise response style guidance for everyday coding sessions.

## Quick Start

Install the latest code from `main` globally:

```bash
pi install git:github.com/zz-jason/pi-extensions@main
```

Or install it only for the current project:

```bash
pi install -l git:github.com/zz-jason/pi-extensions@main
```

Restart pi after installation, or run `/reload` in an existing session.

## Extensions

| Extension                                          | Description                                                                                                                        | Commands / UX                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [`context-status`](extensions/context-status)      | Replaces the default footer with compact work dir, session, task, context usage, model, and thinking information.                  | Footer plus `/info` centered context popup.    |
| [`show-agents`](extensions/show-agents/index.ts)   | Displays the current pi-rooted recursive process tree, keeping only detected coding-agent processes such as pi, codex, and claude. | `/show-agents` centered live popup.            |
| [`auto-compact-70`](extensions/auto-compact-70.ts) | Compacts context after usage crosses 70% and resumes likely unfinished work without duplicating pi's built-in overflow recovery.   | Automatic compaction plus `/compact70`.        |
| [`response-style`](extensions/response-style.ts)   | Appends focused response guidance so the agent acts directly, leads with conclusions, and keeps ordinary final responses concise.  | No command; applied through extension loading. |

Footer example:

```text
/data01/code • pi extension                                      ready • 60%/272k • openai-codex/gpt-5.5 • high
```

`/info` opens a centered popup with session, model, Git, runtime, and changed file details. It closes with `Esc`, `Ctrl+C`, or `Enter`.

## Configuration

The package declares its extensions in `package.json`:

```json
{
  "pi": {
    "extensions": [
      "./extensions/context-status/index.ts",
      "./extensions/auto-compact-70.ts",
      "./extensions/response-style.ts"
    ]
  }
}
```

You can also enable individual extension files from your pi settings when you want a smaller setup.

## Development

```bash
npm ci
npm run validate
```

`npm run validate` runs formatting, linting, type checking, coverage tests, and a package dry run.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) before opening a pull request.

## Security

Please report vulnerabilities through the process described in [SECURITY.md](.github/SECURITY.md).

## License

[MIT](LICENSE)
