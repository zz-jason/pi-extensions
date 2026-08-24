# pi-extensions

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

| Extension                                     | Description                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`context-status`](extensions/context-status) | Shows the working directory, Git branch, proxy status, task duration, token usage, cost, model, and thinking level in a compact TUI footer. |

`context-status` replaces the complete default footer. Another extension that sets a custom footer may override it or be overridden by it. Proxy values are never displayed.

Licensed under the [MIT License](LICENSE).
