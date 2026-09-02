import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, TUI } from "@earendil-works/pi-tui";

const REFRESH_INTERVAL_MS = 1_000;
const PS_TIMEOUT_MS = 2_000;
const POPUP_WIDTH = "90%";
const MAX_SUMMARY_LENGTH = 120;

type AgentKind = "pi" | "codex" | "claude" | "opencode" | "aider" | "goose" | "gemini" | "other";

type ProcessRow = {
  pid: number;
  ppid: number;
  state: string;
  elapsed: string;
  command: string;
};

export type AgentProcess = ProcessRow & {
  kind: AgentKind;
  binary: string;
  summary: string;
  parentPid: number | null;
  children: AgentProcess[];
};

type Snapshot = {
  rootPid: number;
  root: AgentProcess;
  count: number;
  error?: string;
};

type AgentTreeOptions = {
  detachedRootSummaries?: ReadonlyMap<number, string>;
};

type ParsedCommand = {
  kind: AgentKind;
  binary: string;
  agentTokenIndex: number;
  tokens: string[];
};

const AGENT_NAMES: Array<[AgentKind, string, RegExp]> = [
  ["codex", "codex", /^(?:codex|codex-cli)$/i],
  ["claude", "claude", /^(?:claude|claude-code)$/i],
  ["opencode", "opencode", /^opencode$/i],
  ["aider", "aider", /^aider$/i],
  ["goose", "goose", /^goose$/i],
  ["gemini", "gemini", /^(?:gemini|gemini-cli)$/i],
];

function shellSplit(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "single" | "double" | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "single") {
      escaped = true;
      continue;
    }
    if (quote === "single") {
      if (char === "'") quote = null;
      else token += char;
      continue;
    }
    if (quote === "double") {
      if (char === '"') quote = null;
      else token += char;
      continue;
    }
    if (char === "'") {
      quote = "single";
      continue;
    }
    if (char === '"') {
      quote = "double";
      continue;
    }
    if (/\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += char;
  }

  if (escaped) token += "\\";
  if (token) tokens.push(token);
  return tokens;
}

function basename(value: string): string {
  return value.split(/[\\/]/).pop() || value;
}

function normalizeExecutableTokens(tokens: string[]): {
  tokens: string[];
  executableIndex: number;
} {
  if (tokens.length === 0) return { tokens, executableIndex: -1 };

  let executableIndex = 0;
  const first = basename(tokens[0] ?? "").toLowerCase();
  if (first === "env") {
    executableIndex = tokens.findIndex(
      (token, index) => index > 0 && !token.includes("=") && !token.startsWith("-"),
    );
  }
  if (executableIndex < 0) return { tokens, executableIndex: -1 };

  const executable = basename(tokens[executableIndex] ?? "").toLowerCase();
  if (["node", "nodejs", "bun", "deno"].includes(executable)) {
    const scriptIndex = tokens.findIndex(
      (token, index) => index > executableIndex && !token.startsWith("-"),
    );
    if (scriptIndex >= 0) executableIndex = scriptIndex;
  } else if (["npm", "npx", "pnpm", "yarn"].includes(executable)) {
    const commandIndex = tokens.findIndex(
      (token, index) => index > executableIndex && ["exec", "dlx", "run", "node"].includes(token),
    );
    if (commandIndex >= 0 && tokens[commandIndex + 1]) {
      executableIndex = commandIndex + 1;
    } else {
      const candidateIndex = tokens.findIndex(
        (token, index) => index > executableIndex && !token.startsWith("-") && !token.includes("="),
      );
      if (candidateIndex >= 0) executableIndex = candidateIndex;
    }
  }

  return { tokens, executableIndex };
}

function detectCommand(command: string): ParsedCommand | null {
  const rawTokens = shellSplit(command);
  const { tokens, executableIndex } = normalizeExecutableTokens(rawTokens);
  if (executableIndex < 0 || !tokens[executableIndex]) return null;

  const executable = tokens[executableIndex];
  const executableBase = basename(executable);
  const lowerExecutable = executable.toLowerCase();
  const lowerBase = executableBase.toLowerCase();
  // Pi can be launched as a binary, through node/bun, or from its bundled package path.
  if (
    lowerBase === "pi" ||
    lowerBase === "pi.js" ||
    lowerExecutable.includes("pi-coding-agent") ||
    lowerExecutable.includes("/packages/coding-agent/")
  ) {
    return { kind: "pi", binary: "pi", agentTokenIndex: executableIndex, tokens };
  }

  for (const [kind, binary, pattern] of AGENT_NAMES) {
    if (pattern.test(executableBase) || pattern.test(executable)) {
      return { kind, binary, agentTokenIndex: executableIndex, tokens };
    }
  }

  return null;
}

function shortenSummary(summary: string): string {
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) return "interactive session (task unavailable)";
  return normalized.length > MAX_SUMMARY_LENGTH
    ? `${normalized.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
    : normalized;
}

const OPTION_VALUES = new Set([
  "--provider",
  "--model",
  "--api-key",
  "--mode",
  "--thinking",
  "--session",
  "--session-id",
  "--session-dir",
  "--name",
  "-n",
  "--tools",
  "-t",
  "--exclude-tools",
  "-xt",
  "--extension",
  "-e",
  "--skill",
  "--theme",
  "--append-system-prompt",
  "--system-prompt",
  "--tui-mode",
]);

function summarizeCommand(parsed: ParsedCommand): string {
  const args = parsed.tokens.slice(parsed.agentTokenIndex + 1);
  const promptParts: string[] = [];
  let sessionName: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--") {
      promptParts.push(...args.slice(index + 1));
      break;
    }
    if (arg === "exec" || arg === "run") continue;
    if (arg === "-p" || arg === "--prompt" || arg === "--print" || arg === "--message") {
      if (args[index + 1]) promptParts.push(args[++index]!);
      continue;
    }
    if (arg === "--name" || arg === "-n") {
      if (args[index + 1]) sessionName = args[++index];
      continue;
    }
    if (OPTION_VALUES.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    promptParts.push(arg);
  }

  return shortenSummary(
    promptParts.join(" ") || sessionName || "interactive session (task unavailable)",
  );
}

function parsePsOutput(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid)) continue;
    rows.push({ pid, ppid, state: match[3]!, elapsed: match[4]!, command: match[5]!.trim() });
  }
  return rows;
}

function makeAgentProcess(
  row: ProcessRow,
  parsed: ParsedCommand,
  summaryOverride?: string,
): AgentProcess {
  return {
    ...row,
    kind: parsed.kind,
    binary: parsed.binary,
    summary: summaryOverride || summarizeCommand(parsed),
    parentPid: null,
    children: [],
  };
}

function isDescendant(pid: number, rootPid: number, byPid: Map<number, ProcessRow>): boolean {
  const visited = new Set<number>();
  let current = byPid.get(pid);
  while (current && !visited.has(current.pid)) {
    if (current.ppid === rootPid) return true;
    visited.add(current.pid);
    current = byPid.get(current.ppid);
  }
  return false;
}

function isDescendantOfAnyRoot(
  pid: number,
  rootPid: number,
  byPid: Map<number, ProcessRow>,
  detachedRootPids: ReadonlySet<number>,
): boolean {
  if (isDescendant(pid, rootPid, byPid) || detachedRootPids.has(pid)) return true;

  const visited = new Set<number>();
  let current = byPid.get(pid);
  while (current && !visited.has(current.pid)) {
    if (detachedRootPids.has(current.ppid)) return true;
    visited.add(current.pid);
    current = byPid.get(current.ppid);
  }
  return false;
}

function getSessionText(ctx: ExtensionContext): string {
  const parts: string[] = [];
  const entries = ctx.sessionManager.getBranch() as Array<{
    message?: { content?: unknown };
  }>;

  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    visit(record.content);
    visit(record.message);
    visit(record.text);
    visit(record.command);
    visit(record.arguments);
    visit(record.output);
  };

  for (const entry of entries) visit(entry);
  return parts.join("\n");
}

export function getDetachedRootSummaries(
  rows: ProcessRow[],
  rootPid: number,
  sessionText: string,
): Map<number, string> {
  const candidates = new Map(
    rows
      .filter((row) => row.pid !== rootPid && row.ppid === 1 && detectCommand(row.command) !== null)
      .map((row) => [row.pid, row]),
  );
  const summaries = new Map<number, string>();
  const launchPattern =
    /nohup\s+(?:env\s+)?(?:pi|codex(?:-cli)?|claude(?:-code)?|opencode|aider|goose|gemini)\s+-p\s+(['"])([\s\S]*?)\1\s+[^\n]*&\s*echo\s+\$!/gim;
  const matches = [...sessionText.matchAll(launchPattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const launchEnd = (match.index ?? 0) + match[0].length;
    const nextLaunch = matches[index + 1]?.index ?? sessionText.length;
    const outputWindow = sessionText.slice(launchEnd, Math.min(nextLaunch, launchEnd + 2_000));
    const pidMatch = outputWindow.match(/(?:^|\n)\s*(\d{2,})\s*(?:\n|$)/);
    const pid = pidMatch?.[1] ? Number(pidMatch[1]) : NaN;
    const prompt = match[2]?.trim();
    if (!prompt || !Number.isSafeInteger(pid) || !candidates.has(pid)) continue;

    summaries.set(pid, shortenSummary(prompt.split(/[。\n]/, 1)[0] || prompt));
  }

  return summaries;
}

function getRootSummary(ctx: ExtensionContext): string {
  const entries = ctx.sessionManager.getBranch() as Array<{
    type?: string;
    message?: { role?: string; content?: unknown };
  }>;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index]?.message;
    if (!message || message.role !== "user") continue;
    if (typeof message.content === "string") return shortenSummary(message.content);
    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((part): part is { type: "text"; text: string } => {
          return Boolean(
            part && typeof part === "object" && (part as { type?: unknown }).type === "text",
          );
        })
        .map((part) => part.text)
        .join(" ");
      if (text) return shortenSummary(text);
    }
  }

  return "current pi session (task unavailable)";
}

export function buildAgentTree(
  rows: ProcessRow[],
  rootPid: number,
  rootSummary: string,
  options: AgentTreeOptions = {},
): Snapshot {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const detachedRootSummaries = options.detachedRootSummaries ?? new Map<number, string>();
  const detachedRootPids = new Set(detachedRootSummaries.keys());
  const rootRow = byPid.get(rootPid) ?? {
    pid: rootPid,
    ppid: 0,
    state: "?",
    elapsed: "?",
    command: "pi",
  };
  const root: AgentProcess = {
    ...rootRow,
    kind: "pi",
    binary: "pi",
    summary: rootSummary,
    parentPid: null,
    children: [],
  };

  const visible = new Map<number, AgentProcess>([[rootPid, root]]);
  for (const row of rows) {
    if (row.pid === rootPid || !isDescendantOfAnyRoot(row.pid, rootPid, byPid, detachedRootPids))
      continue;
    const parsed = detectCommand(row.command);
    if (!parsed) continue;
    visible.set(row.pid, makeAgentProcess(row, parsed, detachedRootSummaries.get(row.pid)));
  }

  for (const agent of visible.values()) {
    if (agent.pid === rootPid) continue;
    let parent: AgentProcess | undefined;
    if (detachedRootPids.has(agent.pid)) {
      parent = root;
    } else {
      let ancestor = byPid.get(agent.ppid);
      const visited = new Set<number>();
      while (ancestor && !visible.has(ancestor.pid) && !visited.has(ancestor.pid)) {
        visited.add(ancestor.pid);
        ancestor = byPid.get(ancestor.ppid);
      }
      parent = ancestor && visible.get(ancestor.pid);
    }
    if (parent) {
      agent.parentPid = parent.pid;
      parent.children.push(agent);
    }
  }

  const sortTree = (agent: AgentProcess): void => {
    agent.children.sort((left, right) => left.pid - right.pid);
    for (const child of agent.children) sortTree(child);
  };
  sortTree(root);

  return { rootPid, root, count: visible.size };
}

function stateLabel(state: string): string {
  const normalized = state.toUpperCase();
  if (normalized.startsWith("R")) return "running";
  if (normalized.startsWith("S")) return "sleeping";
  if (normalized.startsWith("D")) return "waiting";
  if (normalized.startsWith("T")) return "stopped";
  if (normalized.startsWith("Z")) return "zombie";
  return state || "unknown";
}

function fitLine(text: string, width: number): string {
  const fitted = truncateToWidth(text, width, "…");
  return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
}

function treeLines(agent: AgentProcess, theme: Theme, prefix = "", isLast = true): string[] {
  const connector =
    agent.pid === agent.parentPid || agent.parentPid === null ? "" : isLast ? "└─ " : "├─ ";
  const line = `${prefix}${connector}${theme.fg("accent", String(agent.pid))} ${theme.fg("toolTitle", agent.binary)} ${theme.fg("dim", `(${stateLabel(agent.state)}, ${agent.elapsed})`)} ${theme.fg("text", "·")} ${theme.fg("text", agent.summary)}`;
  const childPrefix = agent.parentPid === null ? "" : `${prefix}${isLast ? "   " : "│  "}`;
  const lines = [line];
  agent.children.forEach((child, index) => {
    lines.push(...treeLines(child, theme, childPrefix, index === agent.children.length - 1));
  });
  return lines;
}

function createPopup(
  tui: TUI,
  theme: Theme,
  getSnapshot: () => Snapshot,
  done: () => void,
): Component {
  let scrollTop = 0;

  const getContentRows = (snapshot: Snapshot): string[] => {
    if (snapshot.error) return [theme.fg("error", snapshot.error)];

    const rows = treeLines(snapshot.root, theme);
    if (snapshot.count === 1) rows.push(theme.fg("dim", "No child coding agents detected."));
    return rows;
  };

  const getViewportHeight = (): number => Math.max(3, Math.floor(tui.terminal.rows * 0.85) - 8);

  return {
    handleInput(data: string): void {
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "return")) {
        done();
        return;
      }

      const contentRows = getContentRows(getSnapshot());
      const maxScrollTop = Math.max(0, contentRows.length - getViewportHeight());
      const pageSize = Math.max(1, getViewportHeight() - 1);
      let nextScrollTop = scrollTop;

      if (matchesKey(data, "up")) nextScrollTop -= 1;
      else if (matchesKey(data, "down")) nextScrollTop += 1;
      else if (matchesKey(data, "pageUp")) nextScrollTop -= pageSize;
      else if (matchesKey(data, "pageDown")) nextScrollTop += pageSize;
      else if (matchesKey(data, "home")) nextScrollTop = 0;
      else if (matchesKey(data, "end")) nextScrollTop = maxScrollTop;
      else return;

      scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
      tui.requestRender();
    },
    invalidate() {},
    render(width: number): string[] {
      const innerWidth = Math.max(1, width - 2);
      const border = (text: string) => theme.fg("border", text);
      const row = (text = "") => border("│") + fitLine(text, innerWidth) + border("│");
      const divider = border(`├${"─".repeat(innerWidth)}┤`);
      const snapshot = getSnapshot();
      const contentRows = getContentRows(snapshot);
      const viewportHeight = getViewportHeight();
      const maxScrollTop = Math.max(0, contentRows.length - viewportHeight);
      scrollTop = Math.max(0, Math.min(maxScrollTop, scrollTop));
      const visibleRows = contentRows.slice(scrollTop, scrollTop + viewportHeight);
      const rangeEnd = Math.min(contentRows.length, scrollTop + viewportHeight);
      const scrollLabel =
        contentRows.length > viewportHeight
          ? `↑↓/PgUp/PgDn · lines ${scrollTop + 1}-${rangeEnd}/${contentRows.length}`
          : "PID · binary · state/elapsed · task summary";

      const title = truncateToWidth(" Coding agents ", innerWidth, "");
      const titleWidth = visibleWidth(title);
      const leftRule = "─".repeat(Math.max(0, Math.floor((innerWidth - titleWidth) / 2)));
      const rightRule = "─".repeat(Math.max(0, innerWidth - titleWidth - leftRule.length));
      const lines = [
        border(`╭${leftRule}`) + theme.fg("accent", title) + border(`${rightRule}╮`),
        row(
          theme.fg(
            "dim",
            `Root PID ${snapshot.rootPid} · ${snapshot.count} coding agent${snapshot.count === 1 ? "" : "s"} · refreshes every 1s`,
          ),
        ),
        divider,
      ];

      for (let index = 0; index < viewportHeight; index += 1) {
        lines.push(row(visibleRows[index] ?? ""));
      }

      lines.push(
        divider,
        row(theme.fg("dim", scrollLabel)),
        row(theme.fg("dim", "Esc / Ctrl+C / Enter · close")),
        border(`╰${"─".repeat(innerWidth)}╯`),
      );
      return lines.map((line) => truncateToWidth(line, width, "…"));
    },
  };
}

async function readSnapshot(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  rootSummary: string,
): Promise<Snapshot> {
  const rootPid = process.pid;
  const args =
    process.platform === "darwin"
      ? ["-axo", "pid=,ppid=,state=,etime=,command="]
      : ["-eo", "pid=,ppid=,stat=,etime=,args="];
  try {
    const result = await pi.exec("ps", args, { cwd: ctx.cwd, timeout: PS_TIMEOUT_MS });
    if (result.code !== 0) {
      return {
        rootPid,
        root: buildAgentTree([], rootPid, rootSummary).root,
        count: 1,
        error: result.stderr.trim() || `ps exited with code ${result.code}`,
      };
    }
    const rows = parsePsOutput(result.stdout);
    const detachedRootSummaries = getDetachedRootSummaries(rows, rootPid, getSessionText(ctx));
    return buildAgentTree(rows, rootPid, rootSummary, { detachedRootSummaries });
  } catch (error) {
    return {
      rootPid,
      root: buildAgentTree([], rootPid, rootSummary).root,
      count: 1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default function registerShowAgents(pi: ExtensionAPI): void {
  let popupOpen = false;

  pi.registerCommand("show-agents", {
    description: "Show the current pi coding-agent process tree",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/show-agents is only available in TUI mode", "warning");
        return;
      }
      if (process.platform !== "darwin" && process.platform !== "linux") {
        ctx.ui.notify("/show-agents currently supports macOS and Linux only", "warning");
        return;
      }
      if (popupOpen) return;

      popupOpen = true;
      const rootSummary = getRootSummary(ctx);
      let snapshot = await readSnapshot(pi, ctx, rootSummary);
      try {
        await ctx.ui.custom<void>(
          (tui, theme, _keybindings, done) => {
            let active = true;
            const refresh = async () => {
              const next = await readSnapshot(pi, ctx, rootSummary);
              if (!active) return;
              snapshot = next;
              tui.requestRender();
            };
            const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
            void refresh();

            return {
              ...createPopup(
                tui,
                theme,
                () => snapshot,
                () => {
                  active = false;
                  clearInterval(timer);
                  done();
                },
              ),
            };
          },
          {
            overlay: true,
            overlayOptions: { anchor: "center", margin: 1, maxHeight: "85%", width: POPUP_WIDTH },
          },
        );
      } finally {
        popupOpen = false;
      }
    },
  });
}
