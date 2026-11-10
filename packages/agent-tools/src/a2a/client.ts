/**
 * A2A client: POST a message to a remote agent and collect its reply, whether the
 * remote answers with one JSON body or an SSE stream.
 */

import { parseSseStream } from "./sse.js";
import { isTerminalEvent } from "./types.js";
import type { A2AClientOptions, A2AMessage, A2ASendParams, A2ASendResult, A2AStreamEvent } from "./types.js";

function requestBody(params: A2ASendParams): Record<string, unknown> {
  return {
    message: params.message,
    ...(params.messageId ? { messageId: params.messageId } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.skill ? { skill: params.skill } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

/** Fold a finished event stream into the send result (Claude Code `result` shape first). */
function streamResult(events: A2AStreamEvent[], sawTerminal: boolean): A2ASendResult {
  const result = events.find((e) => e.type === "result") ?? events.find(isTerminalEvent);
  const resultMsg =
    (result?.message as A2AMessage | undefined) ?? (result?.result as A2AMessage | undefined);
  const textFallback = typeof result?.result === "string" ? result.result : "";
  const message: A2AMessage | undefined =
    resultMsg && typeof resultMsg === "object"
      ? resultMsg
      : textFallback
        ? { role: "agent", parts: [{ type: "text", text: textFallback }] }
        : events
            .filter((e) => e.type === "message" && e.message)
            .map((e) => e.message as A2AMessage)
            .pop();

  let status = "completed";
  if (result?.status === "error" || result?.is_error === true) status = "error";
  else if (result && typeof result.subtype === "string" && result.subtype.startsWith("error")) status = "error";

  return {
    status: sawTerminal ? status : "completed",
    sessionId:
      (result?.session_id as string | undefined) ??
      (events.find((e) => typeof e.session_id === "string")?.session_id as string | undefined),
    message,
    events,
    streamed: true,
  };
}

/**
 * Send a message to a remote agent at `endpoint` and collect its reply.
 *
 * Works against any A2A-compatible endpoint:
 *  - a plain `application/json` one-shot responder, or
 *  - an SSE streaming responder (e.g. Claude Code `--output-format stream-json`).
 *
 * When `onEvent` is provided, each streamed event is delivered as it arrives,
 * before the stream ends.
 */
export async function sendMessage(
  endpoint: string,
  params: A2ASendParams,
  options: A2AClientOptions = {},
  onEvent?: (ev: A2AStreamEvent) => void,
): Promise<A2ASendResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`a2a request timed out after ${timeoutMs}ms`)), timeoutMs);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(options.headers ?? {}),
  };
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody(params)),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`a2a request failed: ${res.status} ${res.statusText} ${text}`.trim());
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

    // --- One-shot JSON responder -----------------------------------------
    if (contentType.includes("application/json")) {
      const json = (await res.json()) as Record<string, unknown>;
      const message = json.message as A2AMessage | undefined;
      const status = (json.status as string | undefined) ?? "completed";
      if (message) onEvent?.({ type: "message", message, status });
      return {
        status,
        sessionId: json.sessionId as string | undefined,
        message,
        events: message ? [{ type: "message", message, status }] : [],
        streamed: false,
      };
    }

    // --- SSE streaming responder ------------------------------------------
    if (contentType.includes("text/event-stream")) {
      if (!res.body) throw new Error("a2a: streaming response had no body");
      const events: A2AStreamEvent[] = [];
      let sawTerminal = false;
      for await (const ev of parseSseStream(res.body as unknown as AsyncIterable<Uint8Array>)) {
        events.push(ev);
        if (isTerminalEvent(ev)) sawTerminal = true;
        onEvent?.(ev);
      }
      return streamResult(events, sawTerminal);
    }

    // --- Fallback: opaque body -------------------------------------------
    const text = await res.text();
    return {
      status: "completed",
      message: { role: "agent", parts: [{ type: "text", text }] },
      events: [],
      streamed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}
