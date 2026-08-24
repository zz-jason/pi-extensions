import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RESPONSE_STYLE_PROMPT = `Response style:
- Act directly when the request is clear.
- Do not restate the user's request.
- Do not narrate routine tool calls or repeat the same plan before each tool call.
- Before a tool call, use at most one short sentence when context is necessary; otherwise call the tool directly.
- Give the conclusion first.
- Keep ordinary final responses concise.
- After completing work, report only the result, changed files or resources, verification, and blockers if any.
- Do not add background explanations or alternative solutions unless requested or necessary.
- For complex analysis, include only evidence that supports the conclusion.`;

export default function registerResponseStyle(pi: ExtensionAPI) {
  // Append response guidance after the loaded project context.
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${RESPONSE_STYLE_PROMPT}`,
  }));
}
