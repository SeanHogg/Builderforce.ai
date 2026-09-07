/**
 * Turns a raw model tool call into the parsed form every dispatcher wants. Malformed
 * JSON never aborts a run — the call proceeds with `{}` and `malformed: true`, so the
 * tool (or the surface's `beforeDispatch`) can tell the model what went wrong.
 */

import type { LoopToolCall, ParsedToolCall } from "./types.js";

/**
 * THE rule for what counts as a tool-argument bag: a plain object, never an array,
 * a scalar or null. Owned here because every surface that hands args to a dispatcher
 * — the kernel below, and any router that unwraps a nested `args` — must agree on it.
 * Anything else collapses to `{}` rather than reaching a tool as a non-bag.
 */
export function asToolArgs(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

export function parseToolArgs(raw: string | undefined | null): { args: Record<string, unknown>; malformed: boolean } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { args: {}, malformed: false };
  try {
    const bag = asToolArgs(JSON.parse(text) as unknown);
    return bag ? { args: bag, malformed: false } : { args: {}, malformed: true };
  } catch {
    return { args: {}, malformed: true };
  }
}

export function parseToolCall(raw: LoopToolCall): ParsedToolCall {
  const { args, malformed } = parseToolArgs(raw.arguments);
  return { id: raw.id, name: raw.name, args, raw, malformed };
}
