# pi-extensions

一组可直接安装的 [pi](https://github.com/earendil-works/pi-mono) Extension，提供简洁、实用的终端交互增强。仓库中的 Extension 可以与用户已有的全局或项目级 Extension 一起加载，不会覆盖其源文件。

## Quick Start

### 全局安装

在当前用户的所有 pi 项目中启用：

```bash
pi install git:github.com/zz-jason/pi-extensions@v0.1.0
```

该命令会将 package 添加到 `~/.pi/agent/settings.json`。用户已有的 `~/.pi/agent/extensions/` 内容会继续正常加载。

### 项目级安装

仅在当前项目中启用：

```bash
pi install -l git:github.com/zz-jason/pi-extensions@v0.1.0
```

该命令会将 package 添加到项目的 `.pi/settings.json`。项目需要先被 pi 信任。安装后重新启动 pi，或在已有会话中执行 `/reload`。

## Included Extension

### `context-status`

在 pi TUI 底部显示一行紧凑状态信息：

- 当前工作目录和 Git branch
- `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 的启用状态
- 当前任务运行时间和上一次任务耗时
- 会话累计 input token、output token 和 cost
- 当前 provider、model 和 thinking level

Extension 安装后自动启用，无需额外配置。它使用 `ctx.ui.setFooter()` 替换整个默认 footer，因此同一会话中其他自定义 footer 可能覆盖它，或被它覆盖。

## Development

临时加载本地代码：

```bash
git clone https://github.com/zz-jason/pi-extensions.git
cd pi-extensions
pi -e ./extensions/context-status.ts
```

新增 Extension 时，将入口文件放入 `extensions/`。单文件 Extension 使用 `.ts` 文件，多文件 Extension 使用包含 `index.ts` 的独立目录。

提交 Issue 或 Pull Request 前，请确认 Extension 不记录凭据、proxy URL、prompt 内容或其他敏感信息。Pi Extension 拥有当前用户的系统权限，安装前应审查源码。

## License

[MIT](LICENSE)
