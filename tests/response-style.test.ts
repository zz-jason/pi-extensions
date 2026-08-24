import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import registerResponseStyle from "../extensions/response-style";

describe("response-style", () => {
  it("appends response guidance after the current system prompt", () => {
    const handlers = new Map<string, (event: { systemPrompt: string }) => unknown>();
    const on = vi.fn((event: string, handler: (event: { systemPrompt: string }) => unknown) => {
      handlers.set(event, handler);
    });
    registerResponseStyle({ on } as unknown as ExtensionAPI);

    const result = handlers.get("before_agent_start")?.({ systemPrompt: "base prompt" }) as {
      systemPrompt: string;
    };

    expect(result.systemPrompt).toContain("base prompt");
    expect(result.systemPrompt).toContain("Response style:");
    expect(result.systemPrompt.indexOf("Response style:")).toBeGreaterThan(
      result.systemPrompt.indexOf("base prompt"),
    );
    expect(result.systemPrompt).toContain("Do not narrate routine tool calls");
  });
});
