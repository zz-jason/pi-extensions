import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import registerContextStatus from "../extensions/context-status";
import {
  compactPath,
  formatDuration,
  formatNumber,
  getProxyLabel,
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
    [-1_000, "0:00"],
    [0, "0:00"],
    [65_000, "1:05"],
    [3_661_000, "1:01:01"],
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
    expect(timer.getLabel(66_000)).toBe("run:1:05");

    timer.stop(67_000);
    timer.stop(80_000);
    expect(timer.isRunning).toBe(false);
    expect(timer.getLabel(90_000)).toBe("last:1:06");
  });

  it("never reports a negative elapsed duration", () => {
    const timer = new TaskTimer();
    timer.start(2_000);
    timer.stop(1_000);
    expect(timer.getLabel()).toBe("last:0:00");
  });
});

describe("context status extension", () => {
  type EventHandler = (event: unknown, context: unknown) => void;
  type FooterComponent = {
    dispose(): void;
    invalidate(): void;
    render(width: number): string[];
  };
  type FooterFactory = (
    tui: { requestRender: ReturnType<typeof vi.fn> },
    theme: { fg: (color: string, text: string) => string },
    footerData: {
      onBranchChange: (callback: () => void) => () => void;
      getGitBranch: () => string | undefined;
    },
  ) => FooterComponent;

  function createRegistration() {
    const handlers = new Map<string, EventHandler>();
    const on = vi.fn((event: string, handler: EventHandler) => handlers.set(event, handler));
    const registerCommand = vi.fn();
    const pi = { on, registerCommand } as unknown as ExtensionAPI;

    registerContextStatus(pi);
    return { handlers, on, registerCommand };
  }

  it("registers lifecycle handlers and its command", () => {
    const { on, registerCommand } = createRegistration();

    expect(on.mock.calls.map(([event]) => event)).toEqual([
      "session_start",
      "turn_start",
      "agent_settled",
      "session_shutdown",
    ]);
    expect(registerCommand).toHaveBeenCalledWith(
      "context-status",
      expect.objectContaining({
        description: expect.any(String),
        handler: expect.any(Function),
      }),
    );
  });

  it("does not install a footer outside TUI mode", () => {
    const { handlers } = createRegistration();
    const setFooter = vi.fn();

    handlers.get("session_start")?.({}, { mode: "print", ui: { setFooter } });

    expect(setFooter).not.toHaveBeenCalled();
  });

  it("renders session status and manages footer resources", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.stubEnv("HOME", "/work");
    vi.stubEnv("ALL_PROXY", "socks://secret");
    vi.stubEnv("HTTPS_PROXY", "https://secret");
    vi.stubEnv("HTTP_PROXY", "");
    vi.stubEnv("all_proxy", "");
    vi.stubEnv("https_proxy", "");
    vi.stubEnv("http_proxy", "");

    const { handlers, registerCommand } = createRegistration();
    const setFooter = vi.fn();
    const notify = vi.fn();
    const context = {
      mode: "tui",
      cwd: "/work/project",
      ui: { setFooter, notify },
      sessionManager: {
        getBranch: () => [
          { type: "custom" },
          {
            type: "message",
            message: {
              role: "assistant",
              usage: { input: 1_500, output: 2_500, cost: { total: 0.123 } },
            },
          },
        ],
      },
      model: { provider: "anthropic", id: "claude", reasoning: true },
      thinkingLevel: "high",
    };

    handlers.get("session_start")?.({}, context);
    const footerFactory = setFooter.mock.calls[0]?.[0] as FooterFactory;
    const requestRender = vi.fn();
    const unsubscribe = vi.fn();
    let branchChange: (() => void) | undefined;
    const component = footerFactory(
      { requestRender },
      { fg: (_color, text) => text },
      {
        onBranchChange(callback) {
          branchChange = callback;
          return unsubscribe;
        },
        getGitBranch: () => "main",
      },
    );

    expect(component.render(200)).toEqual([
      expect.stringContaining("~/project (main) proxy:on(ALL+HTTPS)"),
    ]);
    expect(component.render(200)).toEqual([
      expect.stringContaining("ready ↑1.5k ↓2.5k $0.123 anthropic/claude • high"),
    ]);
    expect(component.render(5)).toHaveLength(1);

    branchChange?.();
    expect(requestRender).toHaveBeenCalledOnce();
    requestRender.mockClear();

    vi.advanceTimersByTime(1_000);
    expect(requestRender).not.toHaveBeenCalled();
    handlers.get("turn_start")?.({}, context);
    vi.advanceTimersByTime(1_000);
    expect(requestRender).toHaveBeenCalledOnce();
    expect(component.render(200)[0]).toContain("run:0:01");

    handlers.get("agent_settled")?.({}, context);
    expect(component.render(200)[0]).toContain("last:0:01");
    handlers.get("session_shutdown")?.({}, context);

    component.invalidate();
    component.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();

    const command = registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, commandContext: unknown) => Promise<void>;
    };
    void command.handler("", context);
    expect(notify).toHaveBeenCalledWith(
      "The context status footer refreshes automatically",
      "info",
    );

    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("renders empty usage and model state", () => {
    vi.stubEnv("ALL_PROXY", "");
    vi.stubEnv("HTTPS_PROXY", "");
    vi.stubEnv("HTTP_PROXY", "");
    vi.stubEnv("all_proxy", "");
    vi.stubEnv("https_proxy", "");
    vi.stubEnv("http_proxy", "");

    const { handlers } = createRegistration();
    const setFooter = vi.fn();
    const context = {
      mode: "tui",
      cwd: "",
      ui: { setFooter },
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "assistant",
              usage: { input: 0, output: 0, cost: { total: 0 } },
            },
          },
        ],
      },
      model: undefined,
      thinkingLevel: undefined,
    };

    handlers.get("session_start")?.({}, context);
    const footerFactory = setFooter.mock.calls[0]?.[0] as FooterFactory;
    const component = footerFactory(
      { requestRender: vi.fn() },
      { fg: (_color, text) => text },
      { onBranchChange: () => vi.fn(), getGitBranch: () => undefined },
    );

    expect(component.render(200)[0]).toContain("proxy:off");
    expect(component.render(200)[0]).toContain("no-model");
    component.dispose();
    vi.unstubAllEnvs();
  });

  it("omits the thinking level for non-reasoning models", () => {
    const { handlers } = createRegistration();
    const setFooter = vi.fn();
    const context = {
      mode: "tui",
      cwd: "/work",
      ui: { setFooter },
      sessionManager: { getBranch: () => [] },
      model: { provider: "provider", id: "model", reasoning: false },
      thinkingLevel: undefined,
    };

    handlers.get("session_start")?.({}, context);
    const footerFactory = setFooter.mock.calls[0]?.[0] as FooterFactory;
    const component = footerFactory(
      { requestRender: vi.fn() },
      { fg: (_color, text) => text },
      { onBranchChange: () => vi.fn(), getGitBranch: () => undefined },
    );

    expect(component.render(200)[0]).toContain("provider/model");
    expect(component.render(200)[0]).not.toContain("•");

    context.model.reasoning = true;
    expect(component.render(200)[0]).toContain("provider/model • off");
    component.dispose();
  });
});
