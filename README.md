# pi-extensions

A small collection of installable extensions for [pi](https://github.com/earendil-works/pi-mono), focused on practical terminal workflow improvements. These extensions load alongside existing user and project extensions without modifying their source files.

## Quick Start

### Global installation

Enable the extensions for the current user across all pi projects:

```bash
pi install git:github.com/zz-jason/pi-extensions@v0.2.0
```

This adds the package to `~/.pi/agent/settings.json`. Existing extensions in `~/.pi/agent/extensions/` continue to load normally.

### Project installation

Enable the extensions only in the current project:

```bash
pi install -l git:github.com/zz-jason/pi-extensions@v0.2.0
```

This adds the package to `.pi/settings.json`. Pi loads project packages after the project is trusted. Restart pi after installation, or run `/reload` in an existing session.

## Included Extension

### `context-status`

Adds a compact TUI footer with:

- the current working directory and Git branch;
- the enabled state of `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY`;
- current and previous task duration;
- cumulative input tokens, output tokens, and cost for the active session branch; and
- the current provider, model, and thinking level.

The extension starts automatically and requires no configuration. It uses `ctx.ui.setFooter()` to replace the complete default footer. Another extension that sets a custom footer may override it or be overridden by it. Proxy values are never displayed.

## Contributing

See the [contributing guide](.github/CONTRIBUTING.md) for local setup, quality checks, and the Conventional Commits policy. Pull requests must pass formatting, linting, type checking, unit tests with coverage, package validation, dependency review, CodeQL, and commit-message validation.

Pi extensions run with the current user's system permissions. Review the source before installation and follow the [security policy](.github/SECURITY.md) when reporting vulnerabilities.

## License

Licensed under the [MIT License](LICENSE).
