/**
 * LocalResultBroker — awaits actual output from a locally-spawned subagent.
 *
 * spawnSubagentDirect() is fire-and-forget: it queues the task with the gateway
 * and returns "accepted" immediately. The agent runs asynchronously and emits a
 * lifecycle "end" or "error" event via onAgentEvent when it completes.
 *
 * awaitLocalSubagentResult() bridges this gap for the orchestrator:
 *   1. Subscribes to agent events for the given runId.
 *   2. When the lifecycle end event arrives, fetches the session history to
 *      extract the subagent's last assistant message (the actual output).
 *   3. Returns that text so the orchestrator can pass it as structured context
 *      to dependent downstream tasks.
 *
 * If no output is found or the runId is missing, returns an empty string.
 * The orchestrator is responsible for providing a fallback string.
 */

import { callGateway } from "../gateway/call.js";
import { logDebug } from "../logger.js";
import { onAgentEvent } from "./agent-events.js";

// ── Text extraction helpers ───────────────────────────────────────────────────

/**
 * Extract plain text from a message content value.
 * Handles: string, Claude content-block array, and plain objects with a text field.
 */
function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .filter((b): b is Record<string, unknown> => b !== null && typeof b === "object")
      .map((b) => (typeof b.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (content !== null && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === "string") {
      return obj.text.trim();
    }
    if (typeof obj.output === "string") {
      return obj.output.trim();
    }
    if (typeof obj.content === "string") {
      return obj.content.trim();
    }
  }
  return "";
}

/**
 * Fetch the last assistant message from a session's history.
 * Returns an empty string if the history is unavailable or has no assistant messages.
 */
async function readSubagentOutput(sessionKey: string): Promise<string> {
  try {
    const history = await callGateway<{ messages?: unknown[] }>({
      method: "chat.history",
      params: { sessionKey, limit: 50 },
      timeoutMs: 10_000,
    });
    const messages = Array.isArray(history?.messages) ? history.messages : [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || typeof msg !== "object") {
        continue;
      }
      const m = msg as Record<string, unknown>;
      if (m.role !== "assistant") {
        continue;
      }
      const text = extractText(m.content ?? m.text);
      if (text) {
        return text;
      }
    }
  } catch (err) {
    logDebug(`[local-result-broker] chat.history failed for ${sessionKey}: ${String(err)}`);
  }
  return "";
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wait for a locally-spawned subagent to finish and return its output.
 *
 * @param runId           The runId returned by spawnSubagentDirect (from the gateway).
 * @param childSessionKey The session key for the child agent (for history fetch).
 * @param timeoutMs       How long to wait before giving up. Default: 10 minutes.
 * @returns The subagent's last assistant message, or "" if unavailable/timed out.
 */
export function awaitLocalSubagentResult(
  runId: string,
  childSessionKey: string,
  timeoutMs = 600_000,
): Promise<string> {
  // Guard: if we have no runId we can never match an event — return immediately
  // rather than hanging for 10 minutes.
  if (!runId || !childSessionKey) {
    logDebug(
      "[local-result-broker] awaitLocalSubagentResult called with empty runId or sessionKey",
    );
    return Promise.resolve("");
  }

  return new Promise<string>((resolve) => {
    let settled = false;

    const deadline = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      stop();
      logDebug(`[local-result-broker] timed out waiting for runId=${runId} after ${timeoutMs}ms`);
      resolve("");
    }, timeoutMs);

    const stop = onAgentEvent((evt) => {
      if (settled) {
        return;
      }
      if (evt.runId !== runId) {
        return;
      }
      const phase = typeof evt.data?.phase === "string" ? evt.data.phase : null;
      if (phase !== "end" && phase !== "error") {
        return;
      }

      settled = true;
      clearTimeout(deadline);
      stop();

      readSubagentOutput(childSessionKey)
        .then(resolve)
        .catch(() => resolve(""));
    });
  });
}
