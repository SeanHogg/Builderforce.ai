/**
 * The transcript's NODES — what each durable message or trace step becomes on the
 * timeline, and the per-kind sort rank. Split from `timelineModel.ts` (which orders them):
 * this module derives ONE message's node, cached per message object, so a trace event in
 * a 5,000-row chat re-derives nothing it already derived — no JSON re-parse per persisted
 * step, and the SAME node objects come back, which keeps the memoized rows from
 * re-rendering on every step.
 *
 * Pure: no React, no DOM.
 */

import {
  consolidationMarkerOf,
  CONSOLIDATION_MARKER_PREFIX,
  isStepMessage,
  parseChatActivity,
  parseStepMessage,
  stepSig,
  type BrainMessage,
  type BrainTraceEvent,
  type ChatActivity,
  type ChatInputAttachment,
  type EvermindRecallItem,
  type EvermindLearnTarget,
  type PersistedStep,
} from '@seanhogg/builderforce-brain-embedded';
import { modelMoveOf, type ModelMove } from './timelineModelMoves';

export interface TimelineImage {
  url: string;
  name?: string;
}

/** Why a turn did not feed the project Evermind (mirrors the api's `BrainLearnSkipReason`). */
export type BrainLearnSkipReason = 'not-attached' | 'not-seeded' | 'frozen';

const LEARN_SKIP_REASONS: readonly string[] = ['not-attached', 'not-seeded', 'frozen'];

function isLearnSkipReason(v: unknown): v is BrainLearnSkipReason {
  return typeof v === 'string' && LEARN_SKIP_REASONS.includes(v);
}

export type TimelineNode =
  | { key: string; kind: 'user'; ts: number; order: number; message: BrainMessage; text: string; images: TimelineImage[] }
  | { key: string; kind: 'assistant'; ts: number; order: number; message: BrainMessage; text: string }
  // A run milestone / agent dispatch: the RUNTIME narrating itself, not the model
  // talking. Carries the structured facts so the renderer composes the sentence in the
  // reader's language rather than showing the server's English one.
  | { key: string; kind: 'activity'; ts: number; order: number; message: BrainMessage; activity: ChatActivity; fallbackText: string }
  | { key: string; kind: 'thinking'; ts: number; order: number; durationMs?: number; step: number }
  | { key: string; kind: 'tool'; ts: number; order: number; label: string; args: unknown; result: unknown; isError: boolean; durationMs?: number }
  | { key: string; kind: 'error'; ts: number; order: number; label: string; message: string }
  // Project-Evermind memory steps — recall (before answering), learn + reconcile (after).
  | { key: string; kind: 'recall'; ts: number; order: number; version: number; count: number; items: EvermindRecallItem[] }
  // A memory-first ANSWER: the model was skipped and memory replied. Not a recall — it
  // grounded nothing and carries no memories, so it must not render as "Recalled 0
  // memories from Evermind v0". `version` is set only when Evermind generated it.
  | { key: string; kind: 'memoryAnswer'; ts: number; order: number; source: 'qa-cache' | 'evermind'; version: number | null }
  | { key: string; kind: 'learn'; ts: number; order: number; version: number; skipped?: BrainLearnSkipReason; targets?: EvermindLearnTarget[] }
  | { key: string; kind: 'reconcile'; ts: number; order: number; version: number; count: number }
  // The run moved models — its transcript re-packed for the next model's window, or a
  // local-first turn that fell over to another model (`timelineModelMoves.ts`).
  | { key: string; kind: 'modelMove'; ts: number; order: number; move: ModelMove }
  // The run auto-compacted its working context: `count` older steps folded into the memory
  // `note` it continues from — an AUTO consolidation marker (`@seanhogg/builderforce-memory/working`).
  // `message` is the durable auto marker; null for a fold known only from its run step
  // (no marker was saved — the note then lived only in that run's memory).
  | { key: string; kind: 'compacted'; ts: number; order: number; message: BrainMessage | null; count: number; note: string }
  | { key: string; kind: 'streaming'; ts: number; order: number; text: string };

/** Same-timestamp tie-break so a turn reads recall → thinking → narration → tools
 *  → learn → reconcile → error.
 *
 *  This rank breaks ties ACROSS the two sources only (a message against a trace
 *  step). It must never re-rank the trace against ITSELF — see {@link TRACE_RANK}. */
export const ORDER: Record<TimelineNode['kind'], number> = {
  user: 0,
  recall: 1,
  memoryAnswer: 1,
  thinking: 2,
  assistant: 3,
  // An activity line reports what happened AFTER the turn that triggered it, so it sorts
  // with the tool steps rather than ahead of the narration.
  activity: 4,
  tool: 4,
  modelMove: 4,
  compacted: 4,
  learn: 5,
  reconcile: 6,
  error: 7,
  streaming: 8,
};

/**
 * The rank EVERY trace-derived node sorts at, whatever its kind.
 *
 * The trace is a SEQUENCE, not a bag: the run emitted those events in an order the
 * array already holds. Ranking them against each other by kind therefore destroys
 * real information, and did — a reopened chat used to rehydrate its trace from a
 * since-retired store whose rows were written in ONE batch insert at run end and so
 * all carried the SAME `created_at` (any trace whose stamps tie hits the same case). Every timestamp tied, the kind rank became the
 * only discriminator and regrouped the run into "every Thought, then every tool call"
 * instead of the interleaving that actually happened. (A live run hid this: its events
 * carry distinct wall-clock stamps, which is why sending one new message appeared to
 * "fix" the order.)
 *
 * Collapsing the trace to a single rank keeps the cross-source intent — a step still
 * sorts after the user turn and the narration that share its instant — while leaving
 * the trace's own order to the trace. It is also what makes the comparator a TOTAL
 * order: ranking within one stream by kind and across streams by position is
 * intransitive (tool-before-thinking in the trace, with an assistant message ranked
 * between them, is a cycle), and an intransitive comparator has no defined result.
 */
export const TRACE_RANK = ORDER.tool;

export function parseTs(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fallback;
}

/** Pull the attachment list a message stored in its metadata JSON (best-effort). */
export function attachmentsOf(message: BrainMessage): ChatInputAttachment[] {
  if (!message.metadata) return [];
  try {
    const meta = JSON.parse(message.metadata) as { attachments?: ChatInputAttachment[] };
    return Array.isArray(meta.attachments) ? meta.attachments : [];
  } catch {
    return [];
  }
}

/**
 * Strip the trailing `[Attached: name](url)` markdown links a sent message
 * carries for its IMAGE attachments — those render as image bubbles instead, so
 * showing the link too is redundant. Non-image attachment links are kept.
 */
function stripImageRefs(text: string, imageNames: Set<string>): string {
  if (imageNames.size === 0) return text;
  return text
    .split('\n')
    .filter((line) => {
      const m = line.match(/^\[Attached:\s*(.+?)\]\((.*)\)\s*$/);
      return !(m && imageNames.has(m[1].trim()));
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Build the timeline node for a tool/memory step (shared by the trace and the
 *  persisted-message paths). Returns null for a category that isn't a step node. */
export function stepNode(step: PersistedStep, ts: number, key: string): TimelineNode | null {
  switch (step.category) {
    case 'tool':
      return { key, kind: 'tool', ts, order: ORDER.tool, label: step.label, args: step.args, result: step.result, isError: !!step.isError, durationMs: step.durationMs };
    case 'error':
      return { key, kind: 'error', ts, order: ORDER.error, label: step.label, message: typeof step.result === 'string' ? step.result : JSON.stringify(step.result ?? '') };
    case 'recall': {
      const r = (step.result ?? {}) as { count?: number; version?: number; items?: EvermindRecallItem[]; skippedLlm?: boolean; source?: string };
      // The memory-first answer shares the `recall` category (it IS memory) but reports
      // an answer, not recalled items — see the run loop's `memory.answer` /
      // `evermind.answer` step.
      if (r.skippedLlm === true || step.label === 'memory.answer' || step.label === 'evermind.answer') {
        const source = r.source === 'evermind' || step.label === 'evermind.answer' ? 'evermind' : 'qa-cache';
        return { key, kind: 'memoryAnswer', ts, order: ORDER.memoryAnswer, source, version: typeof r.version === 'number' && r.version > 0 ? r.version : null };
      }
      return { key, kind: 'recall', ts, order: ORDER.recall, version: typeof r.version === 'number' ? r.version : 0, count: typeof r.count === 'number' ? r.count : (Array.isArray(r.items) ? r.items.length : 0), items: Array.isArray(r.items) ? r.items : [] };
    }
    case 'learn': {
      const r = (step.result ?? {}) as { version?: number; skipped?: boolean; reason?: string; targets?: EvermindLearnTarget[] };
      const skipped = r.skipped && isLearnSkipReason(r.reason) ? r.reason : undefined;
      const targets = Array.isArray(r.targets) ? r.targets : undefined;
      return { key, kind: 'learn', ts, order: ORDER.learn, version: typeof r.version === 'number' ? r.version : 0, ...(skipped ? { skipped } : {}), ...(targets ? { targets } : {}) };
    }
    case 'reconcile': {
      const r = (step.result ?? {}) as { count?: number; version?: number };
      return { key, kind: 'reconcile', ts, order: ORDER.reconcile, version: typeof r.version === 'number' ? r.version : 0, count: typeof r.count === 'number' ? r.count : 0 };
    }
    case 'message': {
      // Narration is the durable assistant message's to render; only a MODEL MOVE is a
      // step — and a fold. A fold normally renders from its durable auto marker (which
      // carries the note), and the build drops this step's row when that marker exists;
      // when none was saved (a failed write, a host that keeps no ids) this row is the
      // only sign the run compacted.
      if (step.label === COMPACTED_STEP) {
        const dropped = (step.args as { droppedMessages?: unknown } | undefined)?.droppedMessages;
        return { key, kind: 'compacted', ts, order: ORDER.compacted, message: null, count: typeof dropped === 'number' ? dropped : 0, note: '' };
      }
      const move = modelMoveOf(step.label, step.args);
      return move ? { key, kind: 'modelMove', ts, order: ORDER.modelMove, move } : null;
    }
    default:
      return null;
  }
}

/** The run step a working-transcript fold records (`completeTurn.ts`). */
export const COMPACTED_STEP = 'context.compacted';

/** A step-only fold row is dropped when a durable marker covers it: one saved no earlier
 *  than this before the step (it is written right after; clocks may disagree a little). */
const MARKER_SKEW_MS = 60_000;

/** Drop the step-only fold rows a durable marker already shows. */
export function withoutCoveredFolds(nodes: TimelineNode[]): TimelineNode[] {
  const markers = nodes.filter((n) => n.kind === 'compacted' && n.message).map((n) => n.ts);
  if (markers.length === 0) return nodes;
  return nodes.filter((n) => !(n.kind === 'compacted' && !n.message && markers.some((t) => t >= n.ts - MARKER_SKEW_MS)));
}

const traceDerived = new WeakMap<BrainTraceEvent, { index: number; step: number; node: TimelineNode | null }>();

/**
 * The node a live trace event renders as, derived ONCE per event object (the trace is
 * copy-on-write: an event never changes after it is pushed), so its memoized row is not
 * re-rendered on every later step. `index` and `step` are part of the identity — a
 * bounded trace that dropped its head shifts both.
 */
export function traceNode(ev: BrainTraceEvent, index: number, step: number): TimelineNode | null {
  const hit = traceDerived.get(ev);
  if (hit && hit.index === index && hit.step === step) return hit.node;
  const ts = parseTs(ev.ts, 1e15 + index); // unparseable trace sorts after dated content
  const node: TimelineNode | null = ev.category === 'llm'
    // "Thought for Xs" = time-to-first-token when the loop captured it (the latency
    // before the model started answering), falling back to the full turn duration for
    // older traces that predate ttftMs.
    ? { key: `trace-${index}`, kind: 'thinking', ts, order: ORDER.thinking, durationMs: ev.ttftMs ?? ev.durationMs, step }
    // 'message' trace events are dropped (the durable assistant message already renders
    // that text) — except a model move or a fold, which `stepNode` turns into its step.
    : stepNode({ category: ev.category, label: ev.label, args: ev.args, result: ev.result, isError: ev.isError, durationMs: ev.durationMs }, ts, `trace-${index}`);
  traceDerived.set(ev, { index, step, node });
  return node;
}

/** One message's derived node, and — for a durable step row — the step's identity, so the
 *  build can drop it when the live trace already carries the same step. */
export interface MessageDerivation {
  node: TimelineNode | null;
  stepSig?: string;
}

const derived = new WeakMap<BrainMessage, MessageDerivation>();

/**
 * The node a durable message renders as, derived ONCE per message object. `index` is
 * the message's position, the timestamp fallback for a row with no `createdAt`.
 */
export function messageNode(message: BrainMessage, index: number): MessageDerivation {
  const hit = derived.get(message);
  if (hit) return hit;
  const out = deriveMessageNode(message, index);
  derived.set(message, out);
  return out;
}

function deriveMessageNode(message: BrainMessage, index: number): MessageDerivation {
  const key = `msg-${message.id}`;
  const ts = parseTs(message.createdAt, index);
  if (message.role === 'user') {
    const images: TimelineImage[] = attachmentsOf(message)
      .filter((a) => a.imageUrl)
      .map((a) => ({ url: a.imageUrl as string, name: a.name }));
    const imageNames = new Set(images.map((im) => im.name).filter((n): n is string => !!n));
    return { node: { key, kind: 'user', ts, order: ORDER.user, message, text: stripImageRefs(message.content, imageNames), images } };
  }
  if (isStepMessage(message)) {
    // A durable tool/memory STEP row — reconstruct its node so it survives a reload. When
    // the metadata isn't a step, render nothing (never a tool row as an assistant bubble).
    const parsed = parseStepMessage(message.metadata);
    if (!parsed) return { node: null };
    return {
      node: stepNode(parsed.step, parseTs(parsed.tsIso, ts), key),
      stepSig: stepSig(parsed.step.category, parsed.step.label, parsed.tsIso),
    };
  }
  // A run's auto-compaction, made durable: the fold row, with the note it continues from.
  const marker = consolidationMarkerOf(message);
  if (marker?.auto) {
    const note = message.content.startsWith(CONSOLIDATION_MARKER_PREFIX)
      ? message.content.slice(CONSOLIDATION_MARKER_PREFIX.length)
      : message.content;
    return { node: { key, kind: 'compacted', ts, order: ORDER.compacted, message, count: marker.folded ?? 0, note } };
  }
  // A run milestone / dispatch is an ACTIVITY line, never an assistant bubble — the
  // runtime said it, not the model, and the reader needs to be able to tell.
  const activity = parseChatActivity(message);
  if (activity) {
    // Pre-structured rows carry only the server's English sentence; showing it beats
    // showing nothing, so it rides along as the fallback.
    return { node: { key, kind: 'activity', ts, order: ORDER.activity, message, activity, fallbackText: message.content } };
  }
  return { node: { key, kind: 'assistant', ts, order: ORDER.assistant, message, text: message.content } };
}
