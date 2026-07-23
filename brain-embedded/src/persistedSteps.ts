/**
 * persistedSteps — the READER for the durable tool/memory step rows the agent
 * loop writes, and the counterpart to `brainRunStore.persistStep`.
 *
 * A run's `trace` is IN-MEMORY ONLY: it lives on the run cell and is gone the
 * moment the chat is closed, remounted, or resumed in another window. That is
 * exactly why every tool/memory step is ALSO persisted as a `role:'tool'` message
 * whose `metadata` carries `{ kind:'step', … }`.
 *
 * Every consumer that wants "the steps of this conversation" therefore has to read
 * BOTH sources and de-duplicate. The timeline already did; the triage diagnostics
 * did not — it counted the live `trace` alone, so a copied transcript of a reopened
 * chat rendered 20 tool calls from the persisted rows while the Diagnostics block
 * above it said `Tool calls: 0`, `Tool results: 0 B`, and — starved of signal —
 * `Likely cause: Inconclusive`. Both now go through {@link traceWithPersistedSteps}.
 */

import type { BrainTraceEvent } from './brainTriage';
import { isStepMessage, type BrainMessage } from './types';

/** A tool/memory step in the shape shared by a live `trace` event and its durable
 *  persisted copy — so ONE builder covers both sources. */
export interface PersistedStep {
  category: string;
  label: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
}

/**
 * Identity of a step across the live trace and its durable copy: same category +
 * label + client timestamp. Lets a step present in BOTH be handled once, while a
 * prior run's step — present only in the messages — still counts.
 */
export function stepSig(category: string, label: string, tsIso: string | undefined): string {
  return `${category}|${label}|${tsIso ?? ''}`;
}

/**
 * Parse a persisted `role:'tool'` step message's metadata into a {@link PersistedStep}
 * plus its client timestamp. Null when the row isn't a well-formed step (so it is
 * never rendered as an assistant bubble or counted as a tool call).
 */
export function parseStepMessage(metadata: string | null): { step: PersistedStep; tsIso?: string } | null {
  if (!metadata) return null;
  try {
    const m = JSON.parse(metadata) as {
      kind?: string; category?: string; label?: string;
      args?: unknown; result?: unknown; isError?: boolean; durationMs?: number; ts?: string;
    };
    if (m.kind !== 'step' || typeof m.category !== 'string') return null;
    return {
      step: {
        category: m.category,
        label: typeof m.label === 'string' ? m.label : m.category,
        args: m.args,
        result: m.result,
        isError: m.isError,
        durationMs: m.durationMs,
      },
      tsIso: typeof m.ts === 'string' ? m.ts : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * The FULL step + turn history of a conversation as trace events: the live
 * in-memory `trace` plus every durable step row the messages carry that the trace
 * doesn't already hold (deduped by {@link stepSig}). Ordered by timestamp so a
 * reader sees the run in sequence.
 *
 * Feed this — not the bare `trace` — to `computeBrainDiagnostics` so a reloaded or
 * resumed chat reports the tool calls it actually made.
 *
 * Two asymmetries this cannot repair, both bounded by what `persistStep` writes:
 * `llm` turn events are not persisted at all (so token counts and turn totals stay
 * session-scoped), and a persisted result is capped at `STEP_RESULT_CAP` (so a
 * recovered step's byte size is a floor, not the pre-trim original). The tool COUNT
 * — the number that was reading a flat zero — is exact.
 */
export function traceWithPersistedSteps(messages: BrainMessage[], trace: BrainTraceEvent[]): BrainTraceEvent[] {
  const seen = new Set<string>();
  for (const ev of trace) {
    if (ev.category !== 'llm' && ev.category !== 'message') seen.add(stepSig(ev.category, ev.label, ev.ts));
  }

  const fromMessages: BrainTraceEvent[] = [];
  for (const message of messages) {
    if (!isStepMessage(message)) continue;
    const parsed = parseStepMessage(message.metadata);
    if (!parsed) continue;
    const sig = stepSig(parsed.step.category, parsed.step.label, parsed.tsIso);
    if (seen.has(sig)) continue;
    seen.add(sig);
    fromMessages.push({
      ts: parsed.tsIso ?? message.createdAt ?? '',
      category: parsed.step.category as BrainTraceEvent['category'],
      label: parsed.step.label,
      args: parsed.step.args,
      result: parsed.step.result,
      ...(parsed.step.isError ? { isError: true } : {}),
      ...(parsed.step.durationMs != null ? { durationMs: parsed.step.durationMs } : {}),
    });
  }

  if (fromMessages.length === 0) return trace;
  return [...trace, ...fromMessages].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}
