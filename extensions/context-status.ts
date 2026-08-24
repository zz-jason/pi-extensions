import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function formatNumber(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${two(minutes)}:${two(seconds)}`;
  return `${minutes}:${two(seconds)}`;
}

function compactPath(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return cwd;
  const normalizedHome = home.replace(/\/$/, "");
  if (cwd === normalizedHome) return "~";
  if (cwd.startsWith(normalizedHome + "/")) return "~" + cwd.slice(normalizedHome.length);
  return cwd;
}

function getProxyLabel(): { enabled: boolean; text: string } {
  const names = [
    ["ALL", process.env.ALL_PROXY || process.env.all_proxy],
    ["HTTPS", process.env.HTTPS_PROXY || process.env.https_proxy],
    ["HTTP", process.env.HTTP_PROXY || process.env.http_proxy],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([name]) => name);

  if (names.length === 0) return { enabled: false, text: "proxy:off" };
  return { enabled: true, text: `proxy:on(${names.join("+")})` };
}

type TaskTimer = {
  running: boolean;
  startedAt: number | null;
  lastElapsedMs: number | null;
};

const taskTimer: TaskTimer = {
  running: false,
  startedAt: null,
  lastElapsedMs: null,
};

function startTaskTimer(): void {
  if (taskTimer.running) return;
  taskTimer.running = true;
  taskTimer.startedAt = Date.now();
  taskTimer.lastElapsedMs = null;
}

function stopTaskTimer(): void {
  if (!taskTimer.running || taskTimer.startedAt === null) return;
  taskTimer.lastElapsedMs = Date.now() - taskTimer.startedAt;
  taskTimer.running = false;
  taskTimer.startedAt = null;
}

function getTimerLabel(): string {
  if (taskTimer.running && taskTimer.startedAt !== null) {
    return `run:${formatDuration(Date.now() - taskTimer.startedAt)}`;
  }
  if (taskTimer.lastElapsedMs !== null) return `last:${formatDuration(taskTimer.lastElapsedMs)}`;
  return "ready";
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
      const timer = setInterval(() => {
        if (taskTimer.running) tui.requestRender();
      }, 1000);

      return {
        dispose() {
          unsubBranch();
          clearInterval(timer);
        },
        invalidate() {},
        render(width: number): string[] {
          const cwd = compactPath(ctx.cwd || process.cwd());
          const branch = footerData.getGitBranch();
          const proxy = getProxyLabel();
          const cwdText = branch ? `${cwd} (${branch})` : cwd;
          const proxyText = proxy.enabled ? theme.fg("success", proxy.text) : theme.fg("dim", proxy.text);
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

          const statsParts = [getTimerLabel()];
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
          if (rightWidth >= width) return [truncateToWidth(right, width, theme.fg("dim", "..."))];

          const leftWidth = Math.max(0, width - rightWidth - 1);
          const renderedLeft = truncateToWidth(left, leftWidth, theme.fg("dim", "..."));
          const gap = Math.max(1, width - visibleWidth(renderedLeft) - rightWidth);
          return [renderedLeft + " ".repeat(gap) + right];
        },
      };
    });
  });

  pi.on("turn_start", async () => startTaskTimer());
  pi.on("agent_settled", async () => stopTaskTimer());
  pi.on("session_shutdown", async () => stopTaskTimer());

  pi.registerCommand("context-status", {
    description: "Refresh the custom footer showing proxy, cwd, git branch, and task runtime",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Context footer refreshes automatically on render", "info");
    },
  });
}
