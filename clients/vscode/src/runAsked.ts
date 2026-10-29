/**
 * The user's ask of a run spec, as plain text. Split from `brainRunHost.ts`.
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
