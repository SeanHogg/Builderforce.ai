/**
 * Two small readings of a run spec the host makes: the user's ask as plain text, and a tool
 * call's arguments as a record. Split from `brainRunHost.ts` (one reason to change each).
 */

import type { RunSpec } from "./childRunHost";

/** The user's ask, whether the panel sent a string or multimodal parts. */
export function askedText(turn: RunSpec["userTurn"]): string | undefined {
  if (typeof turn === "string") {
    const asked = turn.replace(/\s+/g, " ").trim();
    return asked || undefined;
  }
  if (!Array.isArray(turn)) return undefined;
  const parts: string[] = [];
  for (const part of turn) {
    if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  const asked = parts.join(" ").replace(/\s+/g, " ").trim();
  return asked || undefined;
}

export function argsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
