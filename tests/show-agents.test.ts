import { describe, expect, it } from "vitest";

import { buildAgentTree } from "../extensions/show-agents";

describe("show-agents", () => {
  it("builds a coding-agent-only tree through non-agent wrapper processes", () => {
    const snapshot = buildAgentTree(
      [
        { pid: 100, ppid: 1, state: "S", elapsed: "01:00", command: "pi" },
        {
          pid: 101,
          ppid: 100,
          state: "S",
          elapsed: "00:50",
          command: "/bin/zsh -lc codex fix auth",
        },
        { pid: 102, ppid: 101, state: "R", elapsed: "00:20", command: "codex fix auth" },
        { pid: 103, ppid: 102, state: "S", elapsed: "00:10", command: "claude review the diff" },
        { pid: 104, ppid: 1, state: "S", elapsed: "00:05", command: "codex unrelated" },
        { pid: 105, ppid: 100, state: "S", elapsed: "00:05", command: "git status" },
      ],
      100,
      "root task",
    );

    expect(snapshot.count).toBe(3);
    expect(snapshot.root.summary).toBe("root task");
    expect(snapshot.root.children.map((agent) => agent.binary)).toEqual(["codex"]);
    expect(snapshot.root.children[0]?.summary).toBe("fix auth");
    expect(snapshot.root.children[0]?.children[0]?.binary).toBe("claude");
    expect(snapshot.root.children[0]?.children[0]?.summary).toBe("review the diff");
  });

  it("recognizes node-launched pi and keeps command summaries compact", () => {
    const snapshot = buildAgentTree(
      [
        { pid: 200, ppid: 1, state: "S", elapsed: "00:10", command: "pi" },
        {
          pid: 201,
          ppid: 200,
          state: "S",
          elapsed: "00:05",
          command: `/usr/local/bin/node /opt/pi-coding-agent/dist/cli.js --mode rpc -- ${"a ".repeat(100)}`,
        },
      ],
      200,
      "root",
    );

    expect(snapshot.root.children[0]?.binary).toBe("pi");
    expect(snapshot.root.children[0]?.summary.length).toBeLessThanOrEqual(120);
  });
});
