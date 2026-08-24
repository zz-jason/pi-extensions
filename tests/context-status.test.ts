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
  it("registers lifecycle handlers and its command", () => {
    const on = vi.fn();
    const registerCommand = vi.fn();
    const pi = { on, registerCommand } as unknown as ExtensionAPI;

    registerContextStatus(pi);

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
});
