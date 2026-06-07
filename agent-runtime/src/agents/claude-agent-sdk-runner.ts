import { query } from "@anthropic-ai/claude-agent-sdk";
import { logDebug, logWarn } from "../logger.js";
import { mapSdkMessage } from "./claude-agent-v2-events.js";

/**
 * BuilderForce-V2 engine: runs a task with the Claude Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`) — a real agent loop with file/bash tools.
 *
 * Model calls route through the BuilderForce gateway (`ANTHROPIC_BASE_URL`) so
 * the tenant's own Anthropic key is applied + metered server-side; the SDK
 * authenticates to the gateway with the agent host key (`ANTHROPIC_API_KEY`).
 *
 * Streams normalized events to the injected sinks (the relay forwards them onto
 * the same wire frames the V1 loop emits, so the portal renders both identically)
 * and resolves with the final result. Never throws.
 */

export interface V2RunnerSinks {
  onAssistantText(text: string): void;
  onToolUse(toolName: string, toolUseId: string, args: unknown): void;
  onResult(ok: boolean, text: string, usage: { inputTokens: number; outputTokens: number }): void;
}

export interface V2RunParams {
  prompt: string;
  model?: string;
  /** Working directory the agent operates in (the repo/workspace). */
  cwd: string;
  /** Gateway base; the SDK posts Messages to `${anthropicBaseUrl}/v1/messages`. */
  anthropicBaseUrl: string;
  /** Auth key the gateway resolves the tenant from (sent as x-api-key by the SDK). */
  gatewayAuthKey: string;
  /**
   * Assigned-capability block (persona + skill/content references) appended to
   * the SDK's system prompt so the V2 agent adopts what was assigned. Omitted/''
   * when nothing is assigned.
   */
  appendSystemPrompt?: string;
  abortController?: AbortController;
}

export async function runClaudeAgentSdkV2(
  params: V2RunParams,
  sinks: V2RunnerSinks,
): Promise<{ ok: boolean; text: string }> {
  let finalText = "";
  let ok = true;
  let sawResult = false;

  try {
    const stream = query({
      // Prepend the assigned Skills/Personas/Content as a guidance preamble. The
      // SDK's default system prompt is empty, so injecting via the prompt (rather
      // than switching to the claude_code preset) adds the capabilities without
      // changing the V2 agent's base behavior.
      prompt: params.appendSystemPrompt?.trim()
        ? `${params.appendSystemPrompt.trim()}\n\n---\n\n${params.prompt}`
        : params.prompt,
      options: {
        ...(params.model ? { model: params.model } : {}),
        cwd: params.cwd,
        permissionMode: "bypassPermissions",
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        ...(params.abortController ? { abortController: params.abortController } : {}),
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: params.anthropicBaseUrl,
          ANTHROPIC_API_KEY: params.gatewayAuthKey,
        },
        stderr: (data: string) => logDebug(`[v2-runner] ${data}`),
      },
    });

    for await (const msg of stream) {
      for (const ev of mapSdkMessage(msg)) {
        if (ev.kind === "assistant_text") {
          sinks.onAssistantText(ev.text);
        } else if (ev.kind === "tool_use") {
          sinks.onToolUse(ev.toolName, ev.toolUseId, ev.args);
        } else if (ev.kind === "result") {
          sawResult = true;
          ok = ev.ok;
          finalText = ev.text;
          sinks.onResult(ev.ok, ev.text, { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens });
        }
      }
    }

    if (!sawResult) {
      // Stream ended without a terminal result message — treat as a soft failure
      // so the execution doesn't hang in `running`.
      ok = false;
      finalText = finalText || "(agent ended without a result)";
      sinks.onResult(false, finalText, { inputTokens: 0, outputTokens: 0 });
    }
  } catch (err) {
    ok = false;
    finalText = err instanceof Error ? err.message : String(err);
    logWarn(`[v2-runner] failed: ${finalText}`);
    sinks.onResult(false, finalText, { inputTokens: 0, outputTokens: 0 });
  }

  return { ok, text: finalText };
}
