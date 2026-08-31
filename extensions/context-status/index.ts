import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
  compactPath,
  formatGitChangeSummary,
  formatNumber,
  type GitChange,
  parseGitStatus,
  TaskTimer,
} from "./utils";

const POPUP_WIDTH = "80%";
const MAX_VISIBLE_CHANGES = 12;

function fitLine(text: string, width: number): string {
  const fitted = truncateToWidth(text, width, "...");
  return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
}

function formatContextUsage(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
  if (!contextWindow) return "?";

  const percent =
    usage?.percent === null || usage?.percent === undefined ? "?" : `${Math.round(usage.percent)}%`;
  return `${percent}/${formatNumber(contextWindow)}`;
}

function formatDetailedContextUsage(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
  if (!contextWindow) return "?";

  const percent =
    usage?.percent === null || usage?.percent === undefined ? "?" : `${Math.round(usage.percent)}%`;
  const tokens =
    usage?.tokens === null || usage?.tokens === undefined ? undefined : formatNumber(usage.tokens);
  return tokens
    ? `${percent} / ${tokens} / ${formatNumber(contextWindow)}`
    : `${percent} / ${formatNumber(contextWindow)}`;
}

function formatModel(ctx: ExtensionContext): string {
  const model = ctx.model;
  if (!model) return "no-model";

  return `${model.provider}/${model.id}`;
}

function getStatusLine(ctx: ExtensionContext, taskTimer: TaskTimer): string {
  return [
    taskTimer.getLabel(),
    formatContextUsage(ctx),
    formatModel(ctx),
    ctx.thinkingLevel || "off",
  ].join(" • ");
}

function createContextPopup(
  theme: Theme,
  getData: () => {
    branch: string | null;
    changes: GitChange[] | null;
    changesSummary: string;
    commit: string | null;
    contextUsage: string;
    cwd: string;
    dirty: string;
    maxOutput: string;
    model: string;
    queue: string;
    sessionFile: string;
    sessionId: string;
    sessionName: string | undefined;
    task: string;
    thinkingLevel: string;
    tools: string;
    trusted: string;
  },
  done: () => void,
): Component {
  return {
    handleInput(data: string): void {
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "return")) {
        done();
      }
    },
    invalidate() {},
    render(width: number): string[] {
      const innerWidth = Math.max(1, width - 2);
      const border = (text: string) => theme.fg("border", text);
      const row = (text = "") => border("│") + fitLine(text, innerWidth) + border("│");
      const divider = border(`├${"─".repeat(innerWidth)}┤`);
      const section = (title: string) => row(theme.fg("accent", title));
      const field = (label: string, value: string) =>
        row(`  ${theme.fg("dim", label.padEnd(10))}  ${theme.fg("text", value)}`);
      const data = getData();
      const title = truncateToWidth(" Pi context ", innerWidth, "");
      const titleWidth = visibleWidth(title);
      const leftRule = "─".repeat(Math.floor((innerWidth - titleWidth) / 2));
      const rightRule = "─".repeat(Math.max(0, innerWidth - titleWidth - leftRule.length));
      const lines = [
        border(`╭${leftRule}`) + theme.fg("accent", title) + border(`${rightRule}╮`),
        section("Session"),
        field("Name", data.sessionName || "(unnamed)"),
        field("File", data.sessionFile),
        field("ID", data.sessionId),
        field("Work dir", compactPath(data.cwd)),
        field("Trusted", data.trusted),
        divider,
        section("Model"),
        field("Current", data.model),
        field("Thinking", data.thinkingLevel),
        field("Context", data.contextUsage),
        field("Max output", data.maxOutput),
        divider,
        section("Git"),
        field("Branch", data.branch || "(none)"),
        field("Commit", data.commit || "(none)"),
        field("Dirty", data.dirty),
        field("Changes", data.changesSummary),
        divider,
        section("Runtime"),
        field("Task", data.task),
        field("Tools", data.tools),
        field("Queue", data.queue),
        divider,
      ];

      if (data.changes === null) {
        lines.push(row(theme.fg("dim", "Changed files unavailable")));
      } else if (data.changes.length === 0) {
        lines.push(row(theme.fg("dim", "Changed files · clean")));
      } else {
        lines.push(row(theme.fg("dim", `Changed files · ${data.changes.length}`)));
        for (const change of data.changes.slice(0, MAX_VISIBLE_CHANGES)) {
          const color = change.status.includes("D")
            ? "error"
            : change.status.includes("?")
              ? "warning"
              : "accent";
          lines.push(
            row(` ${theme.fg(color, change.status.padEnd(2))} ${theme.fg("text", change.path)}`),
          );
        }
        const hiddenCount = data.changes.length - MAX_VISIBLE_CHANGES;
        if (hiddenCount > 0) lines.push(row(theme.fg("dim", `… ${hiddenCount} more`)));
      }

      lines.push(
        divider,
        row(theme.fg("dim", "Esc / Ctrl+C / Enter · close")),
        border(`╰${"─".repeat(innerWidth)}╯`),
      );
      return lines;
    },
  };
}

export default function registerContextStatus(pi: ExtensionAPI) {
  const taskTimer = new TaskTimer();
  let changes: GitChange[] | null = null;
  let currentBranch: string | null = null;
  let currentCommit: string | null = null;
  let footerTui: { requestRender(): void } | undefined;
  let popupOpen = false;

  const requestRender = () => footerTui?.requestRender();
  const refreshGitInfo = async (ctx: ExtensionContext) => {
    try {
      const result = await pi.exec(
        "git",
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        { cwd: ctx.cwd, timeout: 5_000 },
      );
      changes = result.code === 0 ? parseGitStatus(result.stdout) : null;
    } catch {
      changes = null;
    }

    try {
      const result = await pi.exec("git", ["rev-parse", "--short", "HEAD"], {
        cwd: ctx.cwd,
        timeout: 5_000,
      });
      currentCommit = result.code === 0 ? result.stdout.trim() || null : null;
    } catch {
      currentCommit = null;
    }

    requestRender();
  };
  const showContextPopup = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Context popup is only available in TUI mode", "warning");
      return;
    }
    if (popupOpen) return;

    popupOpen = true;
    await refreshGitInfo(ctx);
    try {
      await ctx.ui.custom<void>(
        (_tui, theme, _keybindings, done) =>
          createContextPopup(
            theme,
            () => ({
              branch: currentBranch,
              changes,
              changesSummary: changes ? formatGitChangeSummary(changes) : "unavailable",
              commit: currentCommit,
              contextUsage: formatDetailedContextUsage(ctx),
              cwd: ctx.cwd || process.cwd(),
              dirty: changes === null ? "unknown" : changes.length > 0 ? "yes" : "no",
              maxOutput: ctx.model?.maxTokens ? formatNumber(ctx.model.maxTokens) : "?",
              model: formatModel(ctx),
              queue: ctx.hasPendingMessages() ? "pending" : "none",
              sessionFile: ctx.sessionManager.getSessionFile() || "In-memory",
              sessionId: ctx.sessionManager.getSessionId(),
              sessionName: pi.getSessionName(),
              task: taskTimer.getLabel(),
              thinkingLevel: ctx.thinkingLevel || "off",
              tools: `${pi.getActiveTools().length} active`,
              trusted: ctx.isProjectTrusted() ? "yes" : "no",
            }),
            done,
          ),
        {
          overlay: true,
          overlayOptions: { anchor: "center", margin: 1, maxHeight: "80%", width: POPUP_WIDTH },
        },
      );
    } finally {
      popupOpen = false;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      footerTui = tui;
      currentBranch = footerData.getGitBranch();
      const unsubscribeFromBranch = footerData.onBranchChange(() => {
        currentBranch = footerData.getGitBranch();
        tui.requestRender();
        void refreshGitInfo(ctx);
      });
      const timer = setInterval(() => {
        if (taskTimer.isRunning) tui.requestRender();
      }, 1_000);

      return {
        dispose() {
          unsubscribeFromBranch();
          clearInterval(timer);
          footerTui = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          currentBranch = footerData.getGitBranch();
          const left = theme.fg(
            "dim",
            [compactPath(ctx.cwd || process.cwd()), pi.getSessionName() || "(unnamed)"].join(" • "),
          );
          const right = theme.fg("dim", getStatusLine(ctx, taskTimer));

          const rightWidth = visibleWidth(right);
          if (rightWidth >= width) {
            return [truncateToWidth(right, width, theme.fg("dim", "..."))];
          }

          const leftWidth = Math.max(0, width - rightWidth - 1);
          const renderedLeft = truncateToWidth(left, leftWidth, theme.fg("dim", "..."));
          const gap = Math.max(1, width - visibleWidth(renderedLeft) - rightWidth);
          return [renderedLeft + " ".repeat(gap) + right];
        },
      };
    });

    await refreshGitInfo(ctx);
  });

  pi.on("session_info_changed", () => requestRender());
  pi.on("model_select", () => requestRender());
  pi.on("thinking_level_select", () => requestRender());
  pi.on("turn_start", () => taskTimer.start());
  pi.on("tool_execution_end", async (event, ctx) => {
    if (!event.isError && ["bash", "edit", "write"].includes(event.toolName)) {
      await refreshGitInfo(ctx);
    }
  });
  pi.on("agent_settled", async (_event, ctx) => {
    taskTimer.stop();
    await refreshGitInfo(ctx);
  });
  pi.on("session_shutdown", () => {
    taskTimer.stop();
    footerTui = undefined;
    popupOpen = false;
  });

  pi.registerCommand("info", {
    description: "Show the context status popup",
    handler: async (_args, ctx) => showContextPopup(ctx),
  });
}
