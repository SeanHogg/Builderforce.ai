/**
 * Pure transcript view-model — frame-work agnostic so the SAME logic drives the
 * web app and the VS Code webview. It merges the durable message list (user +
 * assistant turns) with the live execution trace (LLM turns → "thinking", tool
 * calls → input/output, errors) into one chronologically-ordered list of
 * timeline nodes the renderer maps 1:1 onto gutter dots.
 *
 * No React, no DOM — just data in, nodes out — so it's unit-testable and reused
 * verbatim across surfaces.
 */

import { stepSig, type BrainMessage, type BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { answerTextOf } from '@builderforce/agent-loop';
import { modelMoveOf } from './timelineModelMoves';
import { messageNode, ORDER, traceNode, TRACE_RANK, withoutCoveredFolds, type TimelineNode } from './timelineNodes';

// The node shapes live with their derivation (`timelineNodes.ts`); re-exported unchanged.
export { attachmentsOf } from './timelineNodes';
export type { BrainLearnSkipReason, TimelineImage, TimelineNode } from './timelineNodes';

export interface BuildTimelineInput {
  messages: BrainMessage[];
  trace: BrainTraceEvent[];
  streamingText: string;
  isRunning: boolean;
}

/**
 * Build the ordered timeline. The persisted assistant `message` trace events are
 * dropped (the durable assistant message already carries that text); `llm` turns
 * become "thinking" nodes, `tool`/`error` become their own steps. Everything is
 * sorted by timestamp with a per-kind tie-break, then a stable index tie-break.
 */
export function buildTimeline(input: BuildTimelineInput): TimelineNode[] {
  const nodes = buildSettledTimeline(input.messages, input.trace);
  const streaming = streamingNode(input.streamingText, input.isRunning);
  if (streaming) nodes.push(streaming);
  return nodes;
}

/**
 * The stable, settled portion of the timeline — everything derived from the durable
 * `messages` and `trace` (the expensive map + sort). Split out from {@link buildTimeline}
 * so a live streaming turn (whose text ticks on every token) can be appended cheaply
 * without re-mapping and re-sorting the whole conversation per token.
 *
 * Tool + memory steps come from the live `trace` during a run and are ALSO persisted
 * as `role:'tool'` messages (so they survive a reload — the trace is in-memory only).
 * A step present in both is rendered once (dedup by {@link stepSig}); a prior run's
 * step, present only in the messages, still shows.
 */
export function buildSettledTimeline(messages: BrainMessage[], trace: BrainTraceEvent[]): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  // Steps already contributed by the live trace — so the persisted copy of the same
  // step (same category+label+ts) isn't rendered twice.
  const traceStepSigs = new Set<string>();
  for (const ev of trace) {
    if ((ev.category !== 'llm' && ev.category !== 'message') || modelMoveOf(ev.label, ev.args)) traceStepSigs.add(stepSig(ev.category, ev.label, ev.ts));
  }

  messages.forEach((message, i) => {
    // Derived once per message (`timelineNodes.ts`); a persisted step the live trace
    // already carries is dropped here, because that depends on the trace.
    const { node, stepSig: sig } = messageNode(message, i);
    if (node && !(sig && traceStepSigs.has(sig))) nodes.push(node);
  });

  // Everything pushed from here on is trace-derived, and sorts at TRACE_RANK in the
  // trace's OWN order rather than by kind.
  const messageNodeCount = nodes.length;

  // Derived once per trace event (`timelineNodes.ts`), so a live run's rows stay memoized.
  let step = 0;
  trace.forEach((ev, i) => {
    const node = traceNode(ev, i, step);
    if (ev.category === 'llm') step++;
    if (node) nodes.push(node);
  });

  // Chronological sort on the tuple (timestamp, rank, position). `position` is the
  // node's index in this array — messages in `seq` order, then the trace in run order —
  // so it is unique, which makes the comparator a strict total order and the result
  // independent of the engine's sort implementation.
  //
  // `rank` is the per-kind ORDER for a message and the single TRACE_RANK for a trace
  // step, so a tie between two trace steps falls through to their run order instead of
  // being regrouped by kind (see TRACE_RANK).
  const rank = (n: TimelineNode, i: number): number => (i < messageNodeCount ? n.order : TRACE_RANK);
  const sorted = nodes
    .map((node, i) => ({ node, i, rank: rank(node, i) }))
    .sort((a, b) => a.node.ts - b.node.ts || a.rank - b.rank || a.i - b.i)
    .map((e) => e.node);
  // A fold shows once: from its durable marker when one was saved, else from its step.
  return withoutCoveredFolds(sorted);
}

/**
 * The key of a reply STRANDED inside its own reasoning, or null when there isn't one.
 *
 * A reasoning-only assistant message is normally a single collapsed "Thought" line,
 * and rightly so: the model thought, then called a tool, and never addressed the user.
 * That reading breaks at exactly one place — the END of a settled conversation. A run
 * that stops on a reasoning-only message has said its last word inside the `<think>`
 * block, so collapsing it renders the whole turn as one muted line and shows the
 * reader NOTHING. Reported verbatim: an explicit instruction answered with a question
 * the transcript never displayed, its last row a "Thought" — "to the user, they think
 * the Agent just died".
 *
 * A model whose reply lands in the reasoning channel is not rare (an unclosed
 * `<think>` survives every strip on the way here, because every one of them needs the
 * closing tag), so the transcript has to be able to end on a readable turn regardless.
 * `promoteSwallowedAnswer` in `@builderforce/agent-loop` rescues the neighbouring case — a real
 * answer with only a fragment left outside the block — but deliberately leaves a turn
 * with NO answer segment alone, because mid-run that turn is either still streaming or
 * genuinely had nothing to say. This is the fact that tells the two apart, and it is
 * not in the content: it is the turn's POSITION and whether the run is still going.
 *
 * The scan walks back to the conversation's last MODEL reply — past tool steps, memory
 * rows and runtime narration, which are bookkeeping and can sort either side of it —
 * and stops at a user turn, because a user turn after the reply means the exchange
 * moved on and a pending turn (not a stranded one) is what is missing. Nothing is
 * stranded while `isRunning`: the surface is already showing a live indicator, and the
 * text is still arriving.
 */
export function strandedReplyKey(nodes: readonly TimelineNode[], isRunning: boolean): string | null {
  if (isRunning) return null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    // A live streaming bubble or a user turn: this conversation is mid-exchange.
    if (node.kind === 'streaming' || node.kind === 'user') return null;
    if (node.kind !== 'assistant') continue;
    const text = node.text.trim();
    return text && !answerTextOf(node.text) ? node.key : null;
  }
  return null;
}

/** The trailing live-streaming assistant bubble, or null when nothing is streaming.
 *  Always sorts last (max timestamp), so callers append it after the settled nodes. */
export function streamingNode(streamingText: string, isRunning: boolean): TimelineNode | null {
  if (!isRunning || !streamingText.trim()) return null;
  return { key: 'streaming', kind: 'streaming', ts: Number.MAX_SAFE_INTEGER, order: ORDER.streaming, text: streamingText };
}

/** Compact human duration for a "Thought for …" label (e.g. 0s, 2s, 12s). */
export function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '0s';
  if (ms < 1000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Pretty-print a tool arg/result payload for the IN/OUT panels. */
export function formatPayload(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
