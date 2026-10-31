/**
 * runRows — the transcript rows a turn becomes: the assistant row of a model answer and the tool row of a tool result. Split out of
 * `runTurn.ts` (PRD 35 §5 rule 4). A surface's own tool and a transport may hand back native blocks and fields; the rows keep them.
 */

import type { LoopDispatchResult } from "@builderforce/agent-loop";
import type { RunMessage, RunPart } from "./contract.js";

/** The native blocks and fields a surface's own tool answered with: the codec puts them on the tool row. */
export interface NativeResult {
  parts?: RunPart[];
  meta?: Readonly<Record<string, unknown>>;
}
export const nativeResults = new WeakMap<object, NativeResult>();

/** The native blocks and fields a turn's meta carries onto the assistant row it becomes. */
export function nativeOfTurn(meta: unknown): Pick<RunMessage, "parts" | "meta"> {
  const m = meta && typeof meta === "object" ? (meta as { parts?: RunPart[]; native?: Readonly<Record<string, unknown>> }) : undefined;
  return { ...(m?.parts ? { parts: m.parts } : {}), ...(m?.native ? { meta: m.native } : {}) };
}

/**
 * The transcript row of a tool result. A surface's own tool may hand back native blocks beside its data: the row then keeps
 * them, and its text is the data itself when that is a string (the model reads the tool's words, not a JSON-quoted copy).
 */
export function toolRow(callId: string, result: LoopDispatchResult, verbatim = false): RunMessage {
  const native = nativeResults.get(result);
  return {
    role: "tool",
    toolCallId: callId,
    content: (native || verbatim) && typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? null),
    ...(native?.parts ? { parts: native.parts } : {}),
    ...(native?.meta ? { meta: native.meta } : {}),
    // A call that did not run because the person steered is answered as a failed one: the row says it did not do its work.
    ...(result.isError || (result.data as { skipped?: unknown } | null)?.skipped === true ? { isError: true as const } : {}),
  };
}

/** The data of a tool stopped through its signal: what it returned, marked aborted, so the steering policy answers it as interrupted (not as a failure). */
export function interruptedData(data: unknown): Record<string, unknown> {
  const base = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : { output: data };
  return { ...base, aborted: true };
}
