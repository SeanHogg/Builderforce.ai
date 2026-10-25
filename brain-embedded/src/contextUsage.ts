/**
 * How full the model's context was on the conversation's LAST turn — what the composer's
 * context meter shows.
 *
 * Read from the `llm.complete` step, which is durable (persisted as a step row), so the
 * figure survives a reload: the live trace is searched first, then the persisted step
 * rows. `usage.prompt` is what the gateway reported the turn actually sent; `contextWindow`
 * is the window of the model that served it, stamped by the run when the host knows it
 * (`RunWindowFit.contextWindow`). Unknown window ⇒ the meter shows the count alone.
 *
 * The run keeps the prompt inside the window on its own — `buildWorkingTranscript`
 * folds the older middle into a memory note past `HISTORY_TOKEN_BUDGET` and records a
 * `context.compacted` step — so this is a READOUT, never a gate.
 */

import type { BrainTraceEvent } from './brainTriage';
import { parseStepMessage } from './persistedSteps';
import { isStepMessage, type BrainMessage } from './types';

export interface ContextUsage {
  /** Prompt tokens the last turn sent. */
  promptTokens: number;
  /** The serving model's context window, when known. */
  contextWindow?: number;
  /** The model that served the turn. */
  model?: string;
}

/** The trace label every completed model turn is recorded under. */
const LLM_COMPLETE = 'llm.complete';

const positive = (n: unknown): number | undefined =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;

function usageFrom(args: unknown, usage: { prompt?: number } | undefined): ContextUsage | null {
  const promptTokens = positive(usage?.prompt);
  if (promptTokens === undefined) return null;
  const a = (args ?? {}) as { contextWindow?: unknown; model?: unknown };
  const contextWindow = positive(a.contextWindow);
  return {
    promptTokens,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(typeof a.model === 'string' && a.model ? { model: a.model } : {}),
  };
}

/** A step row's usage, parsed ONCE per message object — a chat whose turns never report
 *  usage would otherwise re-parse every step row on every trace event. */
const rowUsage = new WeakMap<BrainMessage, ContextUsage | null>();

function usageOfRow(m: BrainMessage): ContextUsage | null {
  if (rowUsage.has(m)) return rowUsage.get(m)!;
  const parsed = parseStepMessage(m.metadata);
  const found = parsed && parsed.step.category === 'llm' && parsed.step.label === LLM_COMPLETE
    ? usageFrom(parsed.step.args, parsed.step.usage)
    : null;
  rowUsage.set(m, found);
  return found;
}

/** The last turn's context usage, or null when no turn has reported token usage. */
export function contextUsageOf(messages: readonly BrainMessage[], trace: readonly BrainTraceEvent[]): ContextUsage | null {
  for (let i = trace.length - 1; i >= 0; i--) {
    const ev = trace[i];
    if (ev.category !== 'llm' || ev.label !== LLM_COMPLETE) continue;
    const found = usageFrom(ev.args, ev.usage);
    if (found) return found;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!isStepMessage(m)) continue;
    const found = usageOfRow(m);
    if (found) return found;
  }
  return null;
}
