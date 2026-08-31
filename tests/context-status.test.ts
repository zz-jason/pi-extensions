import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayOptions } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import registerContextStatus from "../extensions/context-status";
import {
  compactPath,
  formatDuration,
  formatGitChangeSummary,
  formatNumber,
  getProxyLabel,
  parseGitStatus,
  TaskTimer,
} from "../extensions/context-status/utils";

describe("context status utilities", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1_000, "1.0k"],
    [9_999, "10.0k"],
    [10_000, "10k"],
    [999_999, "1000k"],
    [1_000_000, "1.0M"],
    [10_000_000, "10M"],
  ])("formats %i as %s", (value, expected) => {
    expect(formatNumber(value)).toBe(expected);
  });

  it.each([
    [-1_000, "0s"],
    [0, "0s"],
    [7_000, "7s"],
    [65_000, "1min 5s"],
    [137_000, "2min 17s"],
    [3_600_000, "1h 0s"],
    [3_661_000, "1h 1min 1s"],
  ])("formats duration %i as %s", (value, expected) => {
    expect(formatDuration(value)).toBe(expected);
  });

  it("compacts paths under the home directory", () => {
    expect(compactPath("/home/alice", "/home/alice/")).toBe("~");
    expect(compactPath("/home/alice/project", "/home/alice")).toBe("~/project");
    expect(compactPath("/srv/project", "/home/alice")).toBe("/srv/project");
    expect(compactPath("/srv/project", undefined)).toBe("/srv/project");
  });

  it("detects default home directories from the environment", () => {
    vi.stubEnv("HOME", "/home/alice");
    vi.stubEnv("USERPROFILE", "");
    expect(compactPath("/home/alice/project")).toBe("~/project");

    vi.stubEnv("HOME", "");
    vi.stubEnv("USERPROFILE", "C:/Users/alice");
    expect(compactPath("C:/Users/alice/project")).toBe("~/project");

    vi.stubEnv("HOME", "");
    vi.stubEnv("USERPROFILE", "");
    expect(compactPath("/srv/project")).toBe("/srv/project");
    vi.unstubAllEnvs();
  });

  it("parses porcelain git status including rename records", () => {
    expect(
      parseGitStatus(
        " M src/modified.ts\0?? src/new.ts\0R  src/renamed.ts\0src/old.ts\0C  copy.ts\0source.ts\0x\0\0",
      ),
    ).toEqual([
      { path: "src/modified.ts", status: " M" },
      { path: "src/new.ts", status: "??" },
      { path: "src/renamed.ts", status: "R " },
      { path: "copy.ts", status: "C " },
    ]);
  });

  it("formats git change summaries", () => {
    expect(formatGitChangeSummary([])).toBe("clean");
    expect(formatGitChangeSummary([{ path: "ignored", status: "!!" }])).toBe("");
    expect(
      formatGitChangeSummary([
        { path: "modified.ts", status: " M" },
        { path: "added.ts", status: "A " },
        { path: "deleted.ts", status: "D " },
        { path: "renamed.ts", status: "R " },
        { path: "new.ts", status: "??" },
      ]),
    ).toBe("1 modified, 1 added, 1 deleted, 1 renamed, 1 untracked");
  });

  it("reports enabled proxy environment variables without exposing values", () => {
    expect(getProxyLabel({})).toEqual({ enabled: false, text: "proxy:off" });
    expect(
      getProxyLabel({
        ALL_PROXY: "socks://secret",
        https_proxy: "https://secret",
        HTTP_PROXY: "http://secret",
      }),
    ).toEqual({ enabled: true, text: "proxy:on(ALL+HTTPS+HTTP)" });
    expect(getProxyLabel()).toEqual(
      expect.objectContaining({ enabled: expect.any(Boolean), text: expect.any(String) }),
    );
  });
});

describe("TaskTimer", () => {
  it("tracks running and completed durations", () => {
    const timer = new TaskTimer();

    expect(timer.isRunning).toBe(false);
    expect(timer.getLabel(1_000)).toBe("ready");

    timer.start(1_000);
    timer.start(2_000);
    expect(timer.isRunning).toBe(true);
    expect(timer.getLabel(66_000)).toBe("Elapsed: 1min 5s");

    timer.stop(67_000);
    timer.stop(80_000);
    expect(timer.isRunning).toBe(false);
    expect(timer.getLabel(90_000)).toBe("Last: 1min 6s");
  });

  it("never reports a negative elapsed duration", () => {
    const timer = new TaskTimer();
    timer.start(2_000);
    timer.stop(1_000);
    expect(timer.getLabel()).toBe("Last: 0s");
  });
});

describe("context status extension", () => {
  type EventHandler = (event: unknown, context: unknown) => void | Promise<void>;
  type FooterComponent = Component & { dispose(): void };
  type FooterFactory = (
    tui: { requestRender: ReturnType<typeof vi.fn> },
    theme: { fg: (color: string, text: string) => string },
    footerData: {
      onBranchChange: (callback: () => void) => () => void;
      getGitBranch: () => string | null;
    },
  ) => FooterComponent;
  type CustomFactory = (
    tui: { requestRender: ReturnType<typeof vi.fn> },
    theme: { fg: (color: string, text: string) => string },
    keybindings: unknown,
    done: () => void,
  ) => Component;

  const theme = { fg: (_color: string, text: string) => text };
  const successfulExecResult = (stdout = "") => ({
    code: 0,
    killed: false,
    stderr: "",
    stdout,
  });

  function createRegistration(options?: {
    activeTools?: string[];
    exec?: ReturnType<typeof vi.fn>;
    sessionName?: string;
  }) {
    const handlers = new Map<string, EventHandler>();
    const on = vi.fn((event: string, handler: EventHandler) => handlers.set(event, handler));
    const registerCommand = vi.fn();
    const registerShortcut = vi.fn();
    const exec = options?.exec ?? vi.fn().mockResolvedValue(successfulExecResult());
    const getActiveTools = vi.fn(() => options?.activeTools ?? ["read", "bash", "edit"]);
    const getSessionName = vi.fn(() => options?.sessionName);
    const pi = {
      exec,
      getActiveTools,
      getSessionName,
      on,
      registerCommand,
      registerShortcut,
    } as unknown as ExtensionAPI;

    registerContextStatus(pi);
    return {
      exec,
      getActiveTools,
      getSessionName,
      handlers,
      on,
      registerCommand,
      registerShortcut,
    };
  }

  function mountFooter(footerFactory: FooterFactory, branch: string | null = "main") {
    const requestRender = vi.fn();
    const unsubscribe = vi.fn();
    let branchChange: (() => void) | undefined;
    const component = footerFactory({ requestRender }, theme, {
      getGitBranch: () => branch,
      onBranchChange(callback) {
        branchChange = callback;
        return unsubscribe;
      },
    });

    return { branchChange, component, requestRender, unsubscribe };
  }

  function createTuiContext(options: {
    custom?: ReturnType<typeof vi.fn>;
    getContextUsage?: () =>
      { contextWindow: number; percent: number | null; tokens: number | null } | undefined;
    model?: {
      contextWindow?: number;
      id: string;
      maxTokens?: number;
      provider: string;
      reasoning: boolean;
    };
    hasPendingMessages?: boolean;
    isProjectTrusted?: boolean;
    notify?: ReturnType<typeof vi.fn>;
    sessionFile?: string | undefined;
    setFooter?: ReturnType<typeof vi.fn>;
    thinkingLevel?: string | undefined;
  }) {
    return {
      cwd: "/data01/code",
      hasPendingMessages: () => options.hasPendingMessages ?? false,
      isProjectTrusted: () => options.isProjectTrusted ?? true,
      getContextUsage:
        options.getContextUsage ??
        (() => ({ contextWindow: 272_000, percent: 60, tokens: 163_200 })),
      mode: "tui",
      model: options.model ?? {
        contextWindow: 272_000,
        id: "gpt-5.5",
        maxTokens: 128_000,
        provider: "openai-codex",
        reasoning: true,
      },
      sessionManager: {
        getBranch: () => [],
        getSessionFile: () =>
          "sessionFile" in options ? options.sessionFile : "/tmp/session.jsonl",
        getSessionId: () => "session-id-123",
      },
      thinkingLevel: options.thinkingLevel ?? "high",
      ui: {
        custom: options.custom ?? vi.fn(),
        notify: options.notify ?? vi.fn(),
        setFooter: options.setFooter ?? vi.fn(),
      },
    };
  }

  it("registers lifecycle handlers and info command", () => {
    const { on, registerCommand, registerShortcut } = createRegistration();

    expect(on.mock.calls.map(([event]) => event)).toEqual([
      "session_start",
      "session_info_changed",
      "model_select",
      "thinking_level_select",
      "turn_start",
      "tool_execution_end",
      "agent_settled",
      "session_shutdown",
    ]);
    expect(registerShortcut).not.toHaveBeenCalled();
    expect(registerCommand).toHaveBeenCalledWith(
      "info",
      expect.objectContaining({
        description: expect.any(String),
        handler: expect.any(Function),
      }),
    );
  });

  it("does not install a footer or inspect git outside TUI mode", async () => {
    const { exec, handlers } = createRegistration();
    const setFooter = vi.fn();

    await handlers.get("session_start")?.({}, { mode: "print", ui: { setFooter } });

    expect(setFooter).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("renders the simplified footer and refreshes git state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    let statusCalls = 0;
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] !== "status") return successfulExecResult("abc123\n");
      statusCalls += 1;
      if (statusCalls === 1) return successfulExecResult(" M one.ts\0");
      if (statusCalls === 2) return successfulExecResult();
      if (statusCalls === 3) return { ...successfulExecResult(), code: 128 };
      throw new Error("git unavailable");
    });
    const { handlers } = createRegistration({ exec, sessionName: "pi extension" });
    const setFooter = vi.fn();
    const context = createTuiContext({ setFooter });

    await handlers.get("session_start")?.({}, context);
    expect(exec).toHaveBeenCalledWith(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: context.cwd, timeout: 5_000 },
    );

    const mounted = mountFooter(setFooter.mock.calls[0]?.[0] as FooterFactory);
    expect(mounted.component.render(120)[0]).toContain("/data01/code • pi extension");
    expect(mounted.component.render(120)[0]).toContain(
      "ready • 60%/272k • openai-codex/gpt-5.5 • high",
    );
    expect(mounted.component.render(5)).toHaveLength(1);

    handlers.get("session_info_changed")?.({}, context);
    handlers.get("model_select")?.({}, context);
    handlers.get("thinking_level_select")?.({}, context);
    expect(mounted.requestRender).toHaveBeenCalledTimes(3);
    mounted.requestRender.mockClear();

    vi.advanceTimersByTime(1_000);
    expect(mounted.requestRender).not.toHaveBeenCalled();
    handlers.get("turn_start")?.({}, context);
    vi.advanceTimersByTime(1_000);
    expect(mounted.requestRender).toHaveBeenCalledOnce();
    expect(mounted.component.render(120)[0]).toContain(
      "Elapsed: 1s • 60%/272k • openai-codex/gpt-5.5 • high",
    );

    mounted.branchChange?.();
    await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(4));

    await handlers.get("tool_execution_end")?.({ isError: true, toolName: "write" }, context);
    await handlers.get("tool_execution_end")?.({ isError: false, toolName: "read" }, context);
    expect(exec).toHaveBeenCalledTimes(4);

    await handlers.get("tool_execution_end")?.({ isError: false, toolName: "edit" }, context);
    expect(exec).toHaveBeenCalledTimes(6);
    await handlers.get("agent_settled")?.({}, context);
    expect(exec).toHaveBeenCalledTimes(8);
    expect(mounted.component.render(120)[0]).toContain("Last: 1s");

    mounted.component.invalidate();
    mounted.component.dispose();
    expect(mounted.unsubscribe).toHaveBeenCalledOnce();
    handlers.get("session_shutdown")?.({}, context);

    vi.useRealTimers();
  });

  it("renders footer fallbacks", async () => {
    const { handlers } = createRegistration();
    const setFooter = vi.fn();
    const context = createTuiContext({
      getContextUsage: () => undefined,
      model: { contextWindow: 1_000, id: "model", provider: "provider", reasoning: false },
      setFooter,
      thinkingLevel: undefined,
    });
    context.cwd = "";

    await handlers.get("session_start")?.({}, context);
    const mounted = mountFooter(setFooter.mock.calls[0]?.[0] as FooterFactory, null);
    expect(mounted.component.render(200)[0]).toContain(`${compactPath(process.cwd())} • (unnamed)`);
    context.thinkingLevel = undefined as never;
    expect(mounted.component.render(200)[0]).toContain("?/1.0k • provider/model • off");

    context.model = undefined as never;
    expect(mounted.component.render(200)[0]).toContain("? • no-model • off");
    mounted.component.dispose();
  });

  it("opens a centered context popup with changed files", async () => {
    const gitChanges = [
      "D  src/deleted.ts",
      "?? src/new.ts",
      ...Array.from({ length: 11 }, (_, index) => ` M src/${index + 1}.ts`),
    ].join("\0");
    const exec = vi.fn(async (_command: string, args: string[]) =>
      args[0] === "status"
        ? successfulExecResult(`${gitChanges}\0`)
        : successfulExecResult("abc123\n"),
    );
    const { handlers, registerCommand } = createRegistration({
      activeTools: ["read", "bash", "edit", "write"],
      exec,
      sessionName: "Popup session",
    });
    let popup: Component | undefined;
    let overlayOptions: { overlay?: boolean; overlayOptions?: OverlayOptions } | undefined;
    const custom = vi.fn(async (factory: CustomFactory, options?: typeof overlayOptions) => {
      let closed = false;
      popup = factory({ requestRender: vi.fn() }, theme, {}, () => {
        closed = true;
      });
      overlayOptions = options;
      popup.handleInput?.("x");
      expect(closed).toBe(false);
      popup.handleInput?.("\x1b");
      popup.handleInput?.("\x03");
      popup.handleInput?.("\r");
      expect(closed).toBe(true);
    });
    const setFooter = vi.fn();
    const context = createTuiContext({ custom, setFooter });

    await handlers.get("session_start")?.({}, context);
    mountFooter(setFooter.mock.calls[0]?.[0] as FooterFactory, "feature/context-popup");
    const command = registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, commandContext: unknown) => Promise<void>;
    };
    await command.handler("", context);

    expect(custom).toHaveBeenCalledOnce();
    expect(overlayOptions).toEqual({
      overlay: true,
      overlayOptions: { anchor: "center", margin: 1, maxHeight: "80%", width: "80%" },
    });
    popup?.invalidate();
    const popupText = popup?.render(80).join("\n") ?? "";
    expect(popupText).toContain("Popup session");
    expect(popupText).toContain("/tmp/session.jsonl");
    expect(popupText).toContain("session-id-123");
    expect(popupText).toContain("/data01/code");
    expect(popupText).toContain("yes");
    expect(popupText).toContain("feature/context-popup");
    expect(popupText).toContain("abc123");
    expect(popupText).toContain("Dirty       yes");
    expect(popupText).toContain("11 modified, 1 deleted, 1 untracked");
    expect(popupText).toContain("openai-codex/gpt-5.5");
    expect(popupText).toContain("high");
    expect(popupText).toContain("60% / 163k / 272k");
    expect(popupText).toContain("Max output  128k");
    expect(popupText).toContain("4 active");
    expect(popupText).toContain("none");
    expect(popupText).toContain("src/deleted.ts");
    expect(popupText).toContain("src/new.ts");
    expect(popupText).toContain("src/1.ts");
    expect(popupText).toContain("… 1 more");
    expect(popup?.render(2)).toHaveLength(42);
  });

  it("opens a centered context popup with fallback data and a single changed file", async () => {
    const exec = vi.fn(async (_command: string, args: string[]) =>
      args[0] === "status" ? successfulExecResult(" M single.ts\0") : successfulExecResult(),
    );
    const { handlers, registerCommand } = createRegistration({ exec });
    let popup: Component | undefined;
    const custom = vi.fn(async (factory: CustomFactory) => {
      popup = factory({ requestRender: vi.fn() }, theme, {}, vi.fn());
    });
    const context = createTuiContext({
      custom,
      getContextUsage: () => ({ contextWindow: 1_000, percent: null, tokens: null }),
      hasPendingMessages: true,
      isProjectTrusted: false,
      sessionFile: undefined,
      setFooter: vi.fn(),
      thinkingLevel: undefined,
    });
    context.cwd = "";
    context.model = undefined as never;
    context.thinkingLevel = undefined as never;

    await handlers.get("session_start")?.({}, context);
    const command = registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, commandContext: unknown) => Promise<void>;
    };
    await command.handler("", context);

    const popupText = popup?.render(80).join("\n") ?? "";
    expect(popupText).toContain(compactPath(process.cwd()));
    expect(popupText).toContain("no-model");
    expect(popupText).toContain("? / 1.0k");
    expect(popupText).toContain("off");
    expect(popupText).toContain("In-memory");
    expect(popupText).toContain("Trusted     no");
    expect(popupText).toContain("Queue       pending");
    expect(popupText).toContain("Changed files · 1");
    expect(popupText).toContain("single.ts");
    expect(popupText).not.toContain("more");
  });

  it("opens a popup with unknown context, added file, and missing commit", async () => {
    const exec = vi.fn(async (_command: string, args: string[]) =>
      args[0] === "status"
        ? successfulExecResult("A  added.ts\0")
        : { ...successfulExecResult(), code: 128 },
    );
    const { handlers, registerCommand } = createRegistration({ exec });
    let popup: Component | undefined;
    const custom = vi.fn(async (factory: CustomFactory) => {
      popup = factory({ requestRender: vi.fn() }, theme, {}, vi.fn());
    });
    const context = createTuiContext({
      custom,
      getContextUsage: () => undefined,
      setFooter: vi.fn(),
    });
    context.model = undefined as never;

    await handlers.get("session_start")?.({}, context);
    const command = registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, commandContext: unknown) => Promise<void>;
    };
    await command.handler("", context);

    const popupText = popup?.render(80).join("\n") ?? "";
    expect(popupText).toContain("Context     ?");
    expect(popupText).toContain("Commit      (none)");
    expect(popupText).toContain("1 added");
  });

  it("shows popup clean and unavailable states", async () => {
    const custom = vi.fn(async (factory: CustomFactory) => {
      popup = factory({ requestRender: vi.fn() }, theme, {}, vi.fn());
    });
    let popup: Component | undefined;
    const cleanRegistration = createRegistration({
      exec: vi.fn().mockResolvedValue(successfulExecResult()),
    });
    const cleanContext = createTuiContext({ custom, setFooter: vi.fn() });
    await cleanRegistration.handlers.get("session_start")?.({}, cleanContext);
    const cleanCommand = cleanRegistration.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, commandContext: unknown) => Promise<void>;
    };
    await cleanCommand.handler("", cleanContext);
    expect(popup?.render(80).join("\n")).toContain("Changed files · clean");

    const unavailableRegistration = createRegistration({
      exec: vi.fn().mockRejectedValue(new Error("git unavailable")),
    });
    const unavailableContext = createTuiContext({ custom, setFooter: vi.fn() });
    await unavailableRegistration.handlers.get("session_start")?.({}, unavailableContext);
    const unavailableCommand = unavailableRegistration.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, commandContext: unknown) => Promise<void>;
    };
    await unavailableCommand.handler("", unavailableContext);
    expect(popup?.render(80).join("\n")).toContain("Changed files unavailable");
  });

  it("warns outside TUI mode and ignores duplicate popup opens", async () => {
    let releaseCustom: (() => void) | undefined;
    const custom = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCustom = resolve;
        }),
    );
    const exec = vi.fn().mockResolvedValue(successfulExecResult());
    const notify = vi.fn();
    const { registerCommand } = createRegistration({ exec });
    const command = registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, commandContext: unknown) => Promise<void>;
    };

    await command.handler("", { mode: "print", ui: { notify } });
    expect(notify).toHaveBeenCalledWith("Context popup is only available in TUI mode", "warning");

    const context = createTuiContext({ custom, notify });
    const first = command.handler("", context);
    await vi.waitFor(() => expect(custom).toHaveBeenCalledOnce());
    await command.handler("", context);
    expect(custom).toHaveBeenCalledOnce();
    releaseCustom?.();
    await first;
  });

  it("resets popup state when popup rendering fails", async () => {
    const custom = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const exec = vi.fn().mockResolvedValue(successfulExecResult());
    const { registerCommand } = createRegistration({ exec });
    const context = createTuiContext({ custom });
    const command = registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, commandContext: unknown) => Promise<void>;
    };

    await expect(command.handler("", context)).rejects.toThrow("boom");
    await command.handler("", context);
    expect(custom).toHaveBeenCalledTimes(2);
  });
});
