/**
 * Types for `agentImageLoop.mjs` — the image surfaces' agent loop. The module is plain
 * ESM (the container has no build step); this declaration lets the api's TypeScript
 * tests drive it.
 */

export interface ImageLoopToolState {
  messages: Array<Record<string, unknown>>;
  step: number;
  toolCallId: string;
  toolCallIds: string[];
}

export interface ImageLoopIo {
  /** The live transcript, mutated in place. */
  messages: Array<Record<string, unknown>>;
  /** Post the `llm` op and return its body. */
  llm(messages: Array<Record<string, unknown>>): Promise<Record<string, unknown>>;
  /** Run one tool. */
  execTool(name: string, args: Record<string, unknown>, loop: ImageLoopToolState): Promise<unknown>;
  /** Whether the heartbeat saw the run cancelled. */
  isCancelled(): boolean;
  /** Per-result budget for tool rows (PRD C7). Omitted ⇒ plain JSON rows. */
  toolResultPolicy?: (toolName: string, data: unknown) => string;
  /** Which tools only read (PRD D8) — consecutive reads in a turn dispatch concurrently.
   *  Omitted ⇒ every call in order. */
  isReadOnly?: (toolName: string) => boolean;
}

export interface ImageLoopOutcome {
  output: string;
  cancelled: boolean;
  crashed: string | null;
  paused: boolean;
}

export function runImageLoop(io: ImageLoopIo): Promise<ImageLoopOutcome>;
