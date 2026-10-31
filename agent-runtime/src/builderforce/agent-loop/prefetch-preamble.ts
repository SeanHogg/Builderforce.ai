/**
 * The deterministic-first PreFetch gate in the ON-PREM run preamble
 * (docs/design/deterministic-prefetch.md). The channel path consults it from the run's CONTEXT port
 * (`run/channelAdapter.ts`), before turn 1, with the SAME pass the Brain runs use
 * (`@builderforce/prefetch` `runGate`):
 *
 *   - ANSWER → the run settles on the tool's reply (`ContextPack.answer`), no model call;
 *   - PREFETCH → the facts ride the run's volatile tail (after the history, never the
 *     system prompt), beside the run's own ledger;
 *   - LLM → the run goes to the model as usual.
 *
 * Write actions ask through the host port's `confirm` (on-prem: the approval gate the
 * portal answers); a port without one declines them. Nothing is recorded for calibration:
 * on-prem has no next-request reading of whether a decision was accepted.
 */

import { runGate, type GateRunResult, type PrefetchPort } from "@builderforce/prefetch";
import type { AgentMessage } from "../model/agent-types.js";

export interface PrefetchPreamble {
  /** The adopted ANSWER: the text the run settles on. */
  answer?: string;
  /** PREFETCH output for the run's volatile tail. */
  tail: string[];
  /** The gate pass, for the host's trace. Null when the gate was not consulted. */
  pass: GateRunResult | null;
  /** Why the gate failed, when it did — the run then proceeds as if there were no gate. */
  error?: string;
}

const NONE: PrefetchPreamble = { tail: [], pass: null };

/** The person's request: the newest user prompt's text. */
export function promptText(prompts: readonly AgentMessage[]): string {
  for (let i = prompts.length - 1; i >= 0; i--) {
    const m = prompts[i]!;
    if (m.role !== "user") continue;
    const content = (m as { content: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((c: { type?: string; text?: string }) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
    }
  }
  return "";
}

export async function runPrefetchPreamble(
  port: PrefetchPort | undefined,
  prompts: readonly AgentMessage[],
  signal: AbortSignal | undefined,
): Promise<PrefetchPreamble> {
  const request = promptText(prompts).trim();
  if (!port || !request || signal?.aborted) return NONE;
  const adopted: { answer?: string } = {};
  let pass: GateRunResult | null;
  try {
    pass = await runGate(request, port, {
      ...(signal ? { signal } : {}),
      ...(port.confirm ? { confirm: (action, req, detail) => port.confirm!(action, req, detail) } : {}),
      adopt: async ({ result }) => {
        adopted.answer = result.text;
        return true;
      },
    });
  } catch (e) {
    return { ...NONE, error: e instanceof Error ? e.message : String(e) };
  }
  if (!pass) return NONE;
  return { ...(adopted.answer !== undefined ? { answer: adopted.answer } : {}), tail: pass.tail, pass };
}
