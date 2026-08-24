import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const COMPACT_AT_PERCENT = 70;
const CONTINUE_AFTER_COMPACTION_PROMPT = `Continue the original task. First read the compaction summary and current context, identify completed work, and do not repeat it. Then find the first unfinished step and execute it directly. If the original task is already complete, perform the necessary verification and state that it is complete without starting unrelated work.`;

export default function registerAutoCompact70(pi: ExtensionAPI) {
  let compacting = false;
  let continueAfterCompaction = false;
  let continuationTimer: ReturnType<typeof setTimeout> | undefined;
  let previousPercent: number | null | undefined;

  const triggerCompaction = (
    ctx: ExtensionContext,
    customInstructions?: string,
    shouldContinueAfterCompaction = false,
  ) => {
    if (compacting) return;

    compacting = true;
    continueAfterCompaction = shouldContinueAfterCompaction;
    if (ctx.hasUI) {
      ctx.ui.notify(`Context reached ${COMPACT_AT_PERCENT}%, starting compaction`, "info");
    }
    const compactOptions = {
      ...(customInstructions === undefined ? {} : { customInstructions }),
      onComplete: () => {
        compacting = false;
        if (ctx.hasUI) {
          ctx.ui.notify("Compaction completed", "info");
        }
      },
      onError: (error: Error) => {
        compacting = false;
        continueAfterCompaction = false;
        if (ctx.hasUI) {
          ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
        }
      },
    };
    ctx.compact(compactOptions);
  };

  // Threshold compaction only rebuilds context; it does not resume the original task.
  pi.on("session_before_compact", (event) => {
    // Overflow recovery already retries the interrupted turn itself.
    if (event.willRetry) {
      continueAfterCompaction = false;
      return;
    }

    // A continuation request set by this extension takes precedence over session inference.
    if (continueAfterCompaction) return;

    // Also cover Pi's built-in threshold compaction when enabled separately.
    if (event.reason !== "threshold") return;
    const latestAssistant = [...event.branchEntries]
      .reverse()
      .find((entry) => entry.type === "message" && entry.message.role === "assistant");
    if (latestAssistant?.type === "message" && latestAssistant.message.role === "assistant") {
      continueAfterCompaction =
        latestAssistant.message.stopReason === "toolUse" ||
        latestAssistant.message.stopReason === "length";
    }
  });

  // Queue continuation after compaction so manual compaction can finish first.
  pi.on("session_compact", (event, ctx) => {
    if (event.willRetry || !continueAfterCompaction || continuationTimer) return;

    continueAfterCompaction = false;
    continuationTimer = setTimeout(() => {
      continuationTimer = undefined;
      pi.sendUserMessage(CONTINUE_AFTER_COMPACTION_PROMPT, { deliverAs: "followUp" });
    }, 0);
    if (ctx.hasUI) {
      ctx.ui.notify("Compaction completed; continuing the unfinished task", "info");
    }
  });

  // Do not leave a delayed continuation alive after reload or shutdown.
  pi.on("session_shutdown", () => {
    if (continuationTimer) clearTimeout(continuationTimer);
    continuationTimer = undefined;
    continueAfterCompaction = false;
  });

  // Check after every turn so compaction only starts between user prompts.
  pi.on("turn_end", (event, ctx) => {
    const percent = ctx.getContextUsage()?.percent ?? null;
    if (percent === null) return;

    const crossed =
      previousPercent !== undefined &&
      previousPercent !== null &&
      previousPercent < COMPACT_AT_PERCENT;
    previousPercent = percent;
    if (!crossed || percent < COMPACT_AT_PERCENT) return;

    const shouldContinue =
      event.message.role === "assistant" &&
      (event.message.stopReason === "toolUse" || event.message.stopReason === "length");
    triggerCompaction(ctx, undefined, shouldContinue);
  });

  // Manual trigger: /compact70 [instructions]
  pi.registerCommand("compact70", {
    description: "Trigger compaction immediately (70% auto-compact helper)",
    handler: async (args, ctx) => {
      triggerCompaction(ctx, args.trim() || undefined);
    },
  });
}
