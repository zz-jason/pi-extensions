import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import registerAutoCompact70 from "../extensions/auto-compact-70";

type Handler = (event: unknown, context: unknown) => unknown;

type CompactOptions = {
  customInstructions?: string;
  onComplete?: () => void;
  onError?: (error: Error) => void;
};

function createRegistration() {
  const handlers = new Map<string, Handler>();
  const on = vi.fn((event: string, handler: Handler) => handlers.set(event, handler));
  const registerCommand = vi.fn();
  const sendUserMessage = vi.fn();
  const pi = { on, registerCommand, sendUserMessage } as unknown as ExtensionAPI;

  registerAutoCompact70(pi);
  return { handlers, on, registerCommand, sendUserMessage };
}

function createContext(percent: number | null = 50, hasUI = false) {
  const compact = vi.fn();
  const notify = vi.fn();
  let usage: { percent: number | null } | undefined = { percent };
  return {
    compact,
    notify,
    setUsage(nextUsage: { percent: number | null } | undefined) {
      usage = nextUsage;
    },
    context: {
      hasUI,
      ui: { notify },
      compact,
      getContextUsage: () => usage,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("auto-compact-70", () => {
  it("registers lifecycle handlers and the manual command", () => {
    const { on, registerCommand } = createRegistration();

    expect(on.mock.calls.map(([event]) => event)).toEqual([
      "session_before_compact",
      "session_compact",
      "session_shutdown",
      "turn_end",
    ]);
    expect(registerCommand).toHaveBeenCalledWith(
      "compact70",
      expect.objectContaining({
        description: expect.any(String),
        handler: expect.any(Function),
      }),
    );
  });

  it("waits for a threshold crossing before compacting", () => {
    const { handlers } = createRegistration();
    const { context, compact, setUsage } = createContext(75);
    const turnEnd = handlers.get("turn_end");

    turnEnd?.({ message: { role: "assistant", stopReason: "stop" } }, context);
    setUsage(undefined);
    turnEnd?.({ message: { role: "assistant", stopReason: "stop" } }, context);
    setUsage({ percent: null });
    turnEnd?.({ message: { role: "assistant", stopReason: "stop" } }, context);

    expect(compact).not.toHaveBeenCalled();
  });

  it("compacts after crossing the threshold and notifies the user", () => {
    const { handlers } = createRegistration();
    const { context, compact, notify, setUsage } = createContext(50, true);
    const turnEnd = handlers.get("turn_end");

    turnEnd?.({ message: { role: "assistant", stopReason: "stop" } }, context);
    setUsage({ percent: 75 });
    turnEnd?.({ message: { role: "assistant", stopReason: "toolUse" } }, context);

    expect(compact).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("Context reached 70%, starting compaction", "info");

    const options = compact.mock.calls[0]?.[0] as CompactOptions;
    options.onComplete?.();
    expect(notify).toHaveBeenCalledWith("Compaction completed", "info");

    options.onError?.(new Error("failed"));
    expect(notify).toHaveBeenCalledWith("Compaction failed: failed", "error");

    const noUI = createContext(50);
    const noUIRegistration = createRegistration();
    const noUICommand = noUIRegistration.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, commandContext: unknown) => Promise<void>;
    };
    void noUICommand.handler("manual", noUI.context);
    const noUIOptions = noUI.compact.mock.calls[0]?.[0] as CompactOptions;
    noUIOptions.onComplete?.();
    noUIOptions.onError?.(new Error("silent failure"));
  });

  it("does not start a second compaction while one is active", () => {
    const { handlers } = createRegistration();
    const { context, compact, setUsage } = createContext(50);
    const turnEnd = handlers.get("turn_end");

    turnEnd?.({ message: { role: "assistant", stopReason: "stop" } }, context);
    setUsage({ percent: 75 });
    turnEnd?.({ message: { role: "assistant", stopReason: "stop" } }, context);
    setUsage({ percent: 50 });
    turnEnd?.({ message: { role: "assistant", stopReason: "stop" } }, context);
    setUsage({ percent: 75 });
    turnEnd?.({ message: { role: "assistant", stopReason: "stop" } }, context);

    expect(compact).toHaveBeenCalledOnce();
  });

  it("continues an unfinished task after extension-triggered compaction", async () => {
    vi.useFakeTimers();
    const { handlers } = createRegistration();
    const { context, compact, notify, setUsage } = createContext(50, true);
    const turnEnd = handlers.get("turn_end");

    turnEnd?.({ message: { role: "assistant", stopReason: "stop" } }, context);
    setUsage({ percent: 75 });
    turnEnd?.({ message: { role: "assistant", stopReason: "length" } }, context);
    handlers.get("session_before_compact")?.(
      { willRetry: false, reason: "threshold", branchEntries: [] },
      context,
    );

    const complete = compact.mock.calls[0]?.[0] as CompactOptions;
    handlers.get("session_compact")?.({ willRetry: false }, context);
    expect(notify).toHaveBeenCalledWith(
      "Compaction completed; continuing the unfinished task",
      "info",
    );
    handlers.get("session_before_compact")?.(
      { willRetry: false, reason: "threshold", branchEntries: [] },
      context,
    );
    handlers.get("session_shutdown")?.({}, context);

    vi.runAllTimers();
    await Promise.resolve();
    complete.onComplete?.();
  });

  it("handles built-in threshold compaction inference and overflow recovery", () => {
    vi.useFakeTimers();
    const { handlers, sendUserMessage } = createRegistration();
    const { context } = createContext(50);
    const beforeCompact = handlers.get("session_before_compact");
    const sessionCompact = handlers.get("session_compact");

    beforeCompact?.({ willRetry: true, reason: "overflow", branchEntries: [] }, context);
    sessionCompact?.({ willRetry: true }, context);
    beforeCompact?.({ willRetry: false, reason: "manual", branchEntries: [] }, context);
    sessionCompact?.({ willRetry: false }, context);
    beforeCompact?.(
      {
        willRetry: false,
        reason: "threshold",
        branchEntries: [{ type: "message", message: { role: "assistant", stopReason: "toolUse" } }],
      },
      context,
    );
    sessionCompact?.({ willRetry: false }, context);

    vi.runAllTimers();
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Continue the original task"),
      {
        deliverAs: "followUp",
      },
    );
  });

  it("does not infer continuation from completed or unrelated entries", () => {
    vi.useFakeTimers();
    const { handlers, sendUserMessage } = createRegistration();
    const { context } = createContext();
    const beforeCompact = handlers.get("session_before_compact");
    const sessionCompact = handlers.get("session_compact");

    beforeCompact?.(
      {
        willRetry: false,
        reason: "threshold",
        branchEntries: [{ type: "custom" }],
      },
      context,
    );
    beforeCompact?.(
      {
        willRetry: false,
        reason: "threshold",
        branchEntries: [
          { type: "custom" },
          { type: "message", message: { role: "user", stopReason: "toolUse" } },
          { type: "message", message: { role: "assistant", stopReason: "stop" } },
        ],
      },
      context,
    );
    sessionCompact?.({ willRetry: false }, context);
    vi.runAllTimers();

    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("supports manual compaction instructions and clears pending continuation on shutdown", () => {
    vi.useFakeTimers();
    const { handlers, registerCommand, sendUserMessage } = createRegistration();
    const { context, compact } = createContext(50);
    const command = registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, commandContext: unknown) => Promise<void>;
    };

    void command.handler("  preserve the API  ", context);
    const options = compact.mock.calls[0]?.[0] as CompactOptions;
    expect(options.customInstructions).toBe("preserve the API");

    handlers.get("session_shutdown")?.({}, context);
    options.onComplete?.();
    handlers.get("session_compact")?.({ willRetry: false }, context);
    vi.runAllTimers();
    expect(sendUserMessage).not.toHaveBeenCalled();

    void command.handler("", context);
    expect(compact).toHaveBeenCalledTimes(2);
  });
});
