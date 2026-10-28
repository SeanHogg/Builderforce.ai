/**
 * The deterministic-first PreFetch gate in the ON-PREM run preamble
 * (docs/design/deterministic-prefetch.md). On-prem runs do not go through brain-embedded's
 * run store — `attempt.ts` drives this package's native {@link agentLoop} — so the gate is
 * consulted here, at the loop's entry, with the SAME pass the Brain runs use
 * (`@builderforce/prefetch` `runGate`):
 *
 *   - ANSWER → the run settles on the tool's reply: an assistant message, no model call;
 *   - PREFETCH → the facts ride the run's volatile tail (after the history, never the
 *     system prompt), beside the run's own ledger;
 *   - LLM → the loop runs exactly as before.
 *
 * Write actions ask through the host port's `confirm` (on-prem: the approval gate the
 * portal answers); a port without one declines them. Nothing is recorded for calibration:
 * on-prem has no next-request reading of whether a decision was accepted.
 */

import { runGate, type GateRunResult, type PrefetchPort } from "@builderforce/prefetch";
import type { AgentEvent, AgentMessage } from "../model/agent-types.js";
import type { AssistantMessage, Model } from "../model/types.js";
import type { AgentLoopConfig } from "./agent-loop-config.js";
import type { EventStream } from "./event-stream.js";

export interface PrefetchPreamble {
  /** The adopted ANSWER, as the run's assistant message. */
  answer?: AssistantMessage;
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

/** A settled answer, shaped like a turn the model ended — zero usage, nothing was called. */
function answerMessage(text: string, model: Model): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

export async function runPrefetchPreamble(
  port: PrefetchPort | undefined,
  prompts: readonly AgentMessage[],
  model: Model,
  signal: AbortSignal | undefined,
): Promise<PrefetchPreamble> {
  const request = promptText(prompts).trim();
  if (!port || !request || signal?.aborted) return NONE;
  const adopted: { answer?: AssistantMessage } = {};
  let pass: GateRunResult | null;
  try {
    pass = await runGate(request, port, {
      ...(signal ? { signal } : {}),
      ...(port.confirm ? { confirm: (action, req, detail) => port.confirm!(action, req, detail) } : {}),
      adopt: async ({ result }) => {
        adopted.answer = answerMessage(result.text, model);
        return true;
      },
    });
  } catch (e) {
    return { ...NONE, error: e instanceof Error ? e.message : String(e) };
  }
  if (!pass) return NONE;
  return { ...(adopted.answer ? { answer: adopted.answer } : {}), tail: pass.tail, pass };
}

/**
 * The gate at the loop's entry (`agentLoop`). A deterministic ANSWER settles the run with
 * no model call: the answer is emitted, the stream ended, and null returned. Otherwise
 * the config the run proceeds with — PREFETCH facts riding every turn's volatile tail.
 */
export async function gateRunConfig(
  config: AgentLoopConfig,
  prompts: readonly AgentMessage[],
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>,
  newMessages: AgentMessage[],
): Promise<AgentLoopConfig | null> {
  const gate = await runPrefetchPreamble(config.prefetch, prompts, config.model, signal);
  if (gate.answer) {
    newMessages.push(gate.answer);
    stream.push({ type: "message_start", message: gate.answer });
    stream.push({ type: "message_end", message: gate.answer });
    stream.push({ type: "agent_end", messages: newMessages });
    stream.end(newMessages);
    return null;
  }
  return gate.tail.length > 0 ? { ...config, prefetchTail: gate.tail } : config;
}
