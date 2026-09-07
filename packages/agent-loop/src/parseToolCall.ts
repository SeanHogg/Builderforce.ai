/**
 * Turns a raw model tool call into the parsed form every dispatcher wants. Malformed
 * JSON never aborts a run — the call proceeds with `{}` and `malformed: true`, so the
 * tool (or the surface's `beforeDispatch`) can tell the model what went wrong.
 */

import type { LoopToolCall, ParsedToolCall } from "./types.js";

export function parseToolArgs(raw: string | undefined | null): { args: Record<string, unknown>; malformed: boolean } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { args: {}, malformed: false };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { args: parsed as Record<string, unknown>, malformed: false };
    }
    return { args: {}, malformed: true };
  } catch {
    return { args: {}, malformed: true };
  }
}

export function parseToolCall(raw: LoopToolCall): ParsedToolCall {
  const { args, malformed } = parseToolArgs(raw.arguments);
  return { id: raw.id, name: raw.name, args, raw, malformed };
}
