/**
 * A SUB-AGENT run — the same kernel, one level down.
 *
 * A parent agent delegates a self-contained question, a child runs it on its OWN
 * transcript, and the parent receives one answer. The isolation is the entire point:
 * an exploration that would otherwise spend twenty turns filling the parent's context
 * with dead ends costs it a paragraph. A child that shared the parent's messages would
 * just be a more expensive turn.
 *
 * This lives in the kernel package, beside the loop it runs, because it is the same
 * skeleton with a smaller budget and a fixed ending — and because BOTH surfaces that
 * offer delegation need it: the cloud engine (which hands the child a narrowed
 * capability provider) and the extension host (which hands it the read-only half of
 * the local workspace tools). What differs between them is which tools the child gets
 * and how they are dispatched, so both arrive injected; everything else — the brief,
 * the budget, the output cap, the meaning of a truncated answer — is decided ONCE here,
 * or the two surfaces would drift into subtly different delegation semantics.
 *
 * Zero dependencies, like the rest of this package: the tool schemas are opaque (`T`)
 * and simply handed back to the caller's own model port.
 */

import { runAgentLoop } from "./loop.js";
import { openAiChatCodec } from "./openaiCodec.js";
import type { LoopDispatchResult, LoopPorts, LoopTurnResult, ParsedToolCall } from "./types.js";

/** Steps a child may take before it is cut off and its last word returned as partial. */
export const SUBAGENT_MAX_STEPS = 8;

/**
 * How much of the child's answer reaches the parent. A child that rambles must not be
 * able to spend the parent's context — saving that context was the reason to delegate.
 */
export const SUBAGENT_OUTPUT_CHARS = 4000;

/**
 * The child's standing instructions. It has no ticket, no history and no pull request
 * to open: its whole job is to answer the one brief it was given, and finishing is how
 * it hands that answer back.
 */
export function subagentSystemPrompt(readOnly: boolean): string {
  return [
    "You are a sub-agent. Another agent delegated ONE self-contained question to you and is blocked until you answer.",
    "You cannot see its conversation, its ticket or its plan, and it cannot see yours — it receives only your final answer, so that answer must stand alone.",
    readOnly
      ? "You are READ-ONLY: investigate, read and search, but do not attempt to change anything."
      : "You may make the change you were asked to make, and nothing beyond it.",
    "Work efficiently — your step budget is small. Answer with concrete findings: exact file paths, names and line references, and an explicit \"not found\" where that is the honest result.",
    "Never end with a promise to continue; there is no next turn after your answer.",
  ].join("\n");
}

/** One chat row on the child's private transcript. */
type Row = Record<string, unknown>;

export interface SubagentRunArgs<T> {
  /** The child's ENTIRE brief — it sees none of the parent's conversation. */
  task: string;
  /** False only when the delegated work is itself a change the parent wants made. */
  readOnly: boolean;
  /** Tool schemas the child may call. Opaque here; handed straight back to `complete`. */
  tools: T[];
  /** Take one model turn on the child's transcript. Metering, model choice and
   *  telemetry are the surface's business; the loop is this module's. */
  complete(args: { messages: Row[]; tools: T[]; step: number }): Promise<LoopTurnResult>;
  /** Run one of the child's tool calls. */
  dispatch(call: ParsedToolCall): Promise<LoopDispatchResult>;
  /** The PARENT run's cancel signal — a cancelled run must not leave a child spending. */
  signal?: AbortSignal;
  maxSteps?: number;
  outputChars?: number;
}

export interface SubagentRunResult {
  ok: boolean;
  /** The child's answer, capped at {@link SUBAGENT_OUTPUT_CHARS}. */
  output: string;
  /** Turns spent, so the parent can see what the delegation cost. */
  steps: number;
  /** The child hit its budget before answering: `output` is its last word, not a
   *  conclusion, and the parent should treat it as partial. */
  truncated: boolean;
  cancelled: boolean;
}

/**
 * Run one sub-agent to completion.
 *
 * Deliberately has no hooks of its own. A child does not gate its own finish, does not
 * pause for a human and does not compact: it is short by construction, and every one of
 * those behaviours belongs to the parent run that remains accountable for the work.
 * Errors are NOT caught here — the caller decides whether a failed child is a failed
 * tool call (usually) or a cancelled run (when its own signal aborted).
 */
export async function runSubagent<T>(args: SubagentRunArgs<T>): Promise<SubagentRunResult> {
  const messages: Row[] = [
    { role: "system", content: subagentSystemPrompt(args.readOnly) },
    { role: "user", content: args.task },
  ];
  const ports: LoopPorts<Row> = {
    complete: (ctx) => args.complete({ messages, tools: args.tools, step: ctx.step }),
    dispatch: (call) => args.dispatch(call),
  };
  const loop = await runAgentLoop<Row>({
    messages,
    codec: openAiChatCodec<Row>(),
    ports,
    budget: { stepCap: args.maxSteps ?? SUBAGENT_MAX_STEPS },
    ...(args.signal ? { signal: args.signal } : {}),
  });
  return {
    // A child that ran out of budget still ANSWERED something useful more often than
    // not, so `truncated` is reported alongside rather than folded into `ok`. What is
    // not ok is a child that stopped without producing anything at all.
    ok: loop.ok && !loop.cancelled && loop.output.trim().length > 0,
    output: loop.output.slice(0, args.outputChars ?? SUBAGENT_OUTPUT_CHARS),
    steps: loop.step,
    truncated: loop.exhausted,
    cancelled: loop.cancelled,
  };
}
