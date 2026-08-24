import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { compactPath, formatNumber, getProxyLabel, TaskTimer } from "./utils";

const taskTimer = new TaskTimer();

export default function registerContextStatus(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribeFromBranch = footerData.onBranchChange(() => tui.requestRender());
      const timer = setInterval(() => {
        if (taskTimer.isRunning) tui.requestRender();
      }, 1_000);

      return {
        dispose() {
          unsubscribeFromBranch();
          clearInterval(timer);
        },
        invalidate() {},
        render(width: number): string[] {
          const cwd = compactPath(ctx.cwd || process.cwd());
          const branch = footerData.getGitBranch();
          const proxy = getProxyLabel();
          const cwdText = branch ? `${cwd} (${branch})` : cwd;
          const proxyText = proxy.enabled
            ? theme.fg("success", proxy.text)
            : theme.fg("dim", proxy.text);
          const left = `${theme.fg("dim", cwdText)} ${proxyText}`;

          let input = 0;
          let output = 0;
          let cost = 0;
          for (const entry of ctx.sessionManager.getBranch()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
              const message = entry.message as AssistantMessage;
              input += message.usage.input;
              output += message.usage.output;
              cost += message.usage.cost.total;
            }
          }

          const statsParts = [taskTimer.getLabel()];
          if (input) statsParts.push(`↑${formatNumber(input)}`);
          if (output) statsParts.push(`↓${formatNumber(output)}`);
          if (cost) statsParts.push(`$${cost.toFixed(3)}`);

          const model = ctx.model;
          const modelText = model
            ? `${model.provider}/${model.id}${model.reasoning ? ` • ${ctx.thinkingLevel || "off"}` : ""}`
            : "no-model";
          const rightText = [statsParts.join(" "), modelText].join(" ");
          const right = theme.fg("dim", rightText);

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
  });

  pi.on("turn_start", () => taskTimer.start());
  pi.on("agent_settled", () => taskTimer.stop());
  pi.on("session_shutdown", () => taskTimer.stop());

  pi.registerCommand("context-status", {
    description: "Confirm that the context status footer is active",
    handler: async (_args, ctx) => {
      ctx.ui.notify("The context status footer refreshes automatically", "info");
    },
  });
}
