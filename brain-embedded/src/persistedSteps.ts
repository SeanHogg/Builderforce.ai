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
  // --- Diagnostics scalars, persisted verbatim by `persistStep` ---
  /** `tool` steps: pre-trim byte size of the full result (the stored copy is capped). */
  resultBytes?: number;
  /** `tool` steps: the result the model saw was truncated. */
  truncated?: boolean;
  /** `llm` steps: token usage the gateway reported for the turn. */
  usage?: { prompt?: number; completion?: number; total?: number };
  /** `llm` steps: OpenAI finish_reason. */
  finishReason?: string | null;
  /** `llm` steps: length of the assistant text the turn produced. */
  textChars?: number;
  /** `llm` steps: time-to-first-token. */
  ttftMs?: number;
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
    const m = JSON.parse(metadata) as Partial<PersistedStep> & { kind?: string; ts?: string };
    if (m.kind !== 'step' || typeof m.category !== 'string') return null;
    return {
      step: {
        category: m.category,
        label: typeof m.label === 'string' ? m.label : m.category,
        args: m.args,
        result: m.result,
        isError: m.isError,
        durationMs: m.durationMs,
        resultBytes: m.resultBytes,
        truncated: m.truncated,
        usage: m.usage,
        finishReason: m.finishReason,
        textChars: m.textChars,
        ttftMs: m.ttftMs,
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
 * `persistStep` stores the diagnostics scalars alongside each step — the pre-trim
 * `resultBytes` + `truncated` flag on a tool step, and `usage` / `finishReason` /
 * `textChars` on an `llm` turn — so a recovered run reports the same tool counts,
 * payload sizes, token peaks and finish reasons a live one does. Only the step
 * RESULT payload is lossy (capped at `STEP_RESULT_CAP` in the stored copy).
 */
export function traceWithPersistedSteps(messages: BrainMessage[], trace: BrainTraceEvent[]): BrainTraceEvent[] {
  // EVERY category is seeded, including `message`. Most `message` events (narration,
  // `tools.selected`) stay in-memory, but the loop's own self-diagnosis steps —
  // `loop.recover_announced_tool_call`, `loop.model_failover` — are persisted so a
  // reopened chat can still report that the run stalled and how it responded. Seeding
  // only the non-`message` categories double-counted those against their live twins.
  const seen = new Set<string>();
  for (const ev of trace) seen.add(stepSig(ev.category, ev.label, ev.ts));

  const fromMessages: BrainTraceEvent[] = [];
  for (const message of messages) {
    if (!isStepMessage(message)) continue;
    const parsed = parseStepMessage(message.metadata);
    if (!parsed) continue;
    const sig = stepSig(parsed.step.category, parsed.step.label, parsed.tsIso);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const s = parsed.step;
    fromMessages.push({
      ts: parsed.tsIso ?? message.createdAt ?? '',
      recovered: true,
      category: s.category as BrainTraceEvent['category'],
      label: s.label,
      args: s.args,
      result: s.result,
      ...(s.isError ? { isError: true } : {}),
      ...(s.durationMs != null ? { durationMs: s.durationMs } : {}),
      ...(s.ttftMs != null ? { ttftMs: s.ttftMs } : {}),
      ...(s.resultBytes != null ? { resultBytes: s.resultBytes } : {}),
      ...(s.truncated ? { truncated: true } : {}),
      ...(s.usage ? { usage: s.usage } : {}),
      ...(s.finishReason !== undefined ? { finishReason: s.finishReason } : {}),
      ...(s.textChars != null ? { textChars: s.textChars } : {}),
    });
  }

  if (fromMessages.length === 0) return trace;
  return [...trace, ...fromMessages].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/**
 * The trace a REOPENED chat should render: the rows rehydrated from
 * `GET /chats/:id/trace` plus whatever this session has run since, with any event
 * present in both kept once.
 *
 * Both surfaces used to pick one or the other — `live.length > 0 ? live : recovered`.
 * That is not a merge, it is a replacement: reopen a chat with thirty tool steps and
 * they render, then send one message and all thirty vanish, because a three-event live
 * trace now "wins". The either/or was there to stop DOUBLE rendering, which is real —
 * switch away from a chat and back and the run this session already persisted comes
 * back down in the rehydrated rows — but the answer to a duplicate is to drop the
 * duplicate, not the history.
 *
 * Dedup is by {@link stepSig}, the same identity the timeline already uses: category +
 * label + the instant the event happened. That works because the event's own timestamp
 * is now stored (`occurred_at`, migration 1127) and round-trips unchanged. Rows written
 * before it have no recorded instant and fall back to their batch write time, so a
 * legacy row and its live twin do not match — they render twice in that one narrow
 * case (same session, chat revisited) rather than silently erasing the conversation's
 * history in every case.
 */
export function mergeRecoveredTrace(recovered: BrainTraceEvent[], live: BrainTraceEvent[]): BrainTraceEvent[] {
  if (recovered.length === 0) return live;
  if (live.length === 0) return recovered;
  const liveSigs = new Set(live.map((e) => stepSig(e.category, e.label, e.ts)));
  const kept = recovered.filter((e) => !liveSigs.has(stepSig(e.category, e.label, e.ts)));
  // Recovered first: it is the older history by construction (fetched on chat open,
  // before this session ran anything). The timeline sorts by timestamp regardless.
  return kept.length === 0 ? live : [...kept, ...live];
}
