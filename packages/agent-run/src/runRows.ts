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
/** The dispatched results of a surface's own command that its signal KILLED (`PlatformToolResult.aborted`): their rows fail, and say so. */
export const killedResults = new WeakSet<object>();

/** The native blocks and fields a turn's meta carries onto the assistant row it becomes. */
export function nativeOfTurn(meta: unknown): Pick<RunMessage, "parts" | "meta"> {
  const m = meta && typeof meta === "object" ? (meta as { parts?: RunPart[]; native?: Readonly<Record<string, unknown>> }) : undefined;
  return { ...(m?.parts ? { parts: m.parts } : {}), ...(m?.native ? { meta: m.native } : {}) };
}

/**
 * The transcript row of a tool result. A surface's own tool may hand back native blocks beside its data: the row then keeps
 * them, and its text is the data itself when that is a string (the model reads the tool's words, not a JSON-quoted copy).
 *
 * A surface's own command that its signal KILLED is answered in the steering policy's words and fails the row (the trace and the
 * tally say the same); its row keeps no native blocks, which would show what the killed command printed instead of that answer.
 */
export function toolRow(callId: string, result: LoopDispatchResult, verbatim = false): RunMessage {
  const native = nativeResults.get(result);
  const stopped = killedResults.has(result);
  return {
    role: "tool",
    toolCallId: callId,
    content: (native || verbatim) && typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? null),
    ...(native?.parts && !stopped ? { parts: native.parts } : {}),
    ...(native?.meta ? { meta: native.meta } : {}),
    // A call that did not run because the person steered, or that its signal killed, is answered as a failed one: the row says it
    // did not do its work. The dispatch result itself is not an error, so neither is counted as a failure - and the kernel clears the
    // failure streak on it, as on any call that did not fail (a kill resets the streak to 0).
    ...(result.isError || stopped || (result.data as { skipped?: unknown } | null)?.skipped === true ? { isError: true as const } : {}),
  };
}
