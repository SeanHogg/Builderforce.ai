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

import { isStepMessage, type BrainMessage, type BrainTraceEvent, type ChatInputAttachment, type EvermindRecallItem } from '@seanhogg/builderforce-brain-embedded';

export interface TimelineImage {
  url: string;
  name?: string;
}

export type TimelineNode =
  | { key: string; kind: 'user'; ts: number; order: number; message: BrainMessage; text: string; images: TimelineImage[] }
  | { key: string; kind: 'assistant'; ts: number; order: number; message: BrainMessage; text: string }
  | { key: string; kind: 'thinking'; ts: number; order: number; durationMs?: number; step: number }
  | { key: string; kind: 'tool'; ts: number; order: number; label: string; args: unknown; result: unknown; isError: boolean; durationMs?: number }
  | { key: string; kind: 'error'; ts: number; order: number; label: string; message: string }
  // Project-Evermind memory steps — recall (before answering), learn + reconcile (after).
  | { key: string; kind: 'recall'; ts: number; order: number; version: number; count: number; items: EvermindRecallItem[] }
  | { key: string; kind: 'learn'; ts: number; order: number; version: number }
  | { key: string; kind: 'reconcile'; ts: number; order: number; version: number; count: number }
  | { key: string; kind: 'streaming'; ts: number; order: number; text: string };

export interface BuildTimelineInput {
  messages: BrainMessage[];
  trace: BrainTraceEvent[];
  streamingText: string;
  isRunning: boolean;
}

/** Same-timestamp tie-break so a turn reads recall → thinking → narration → tools
 *  → learn → reconcile → error. */
const ORDER: Record<TimelineNode['kind'], number> = {
  user: 0,
  recall: 1,
  thinking: 2,
  assistant: 3,
  tool: 4,
  learn: 5,
  reconcile: 6,
  error: 7,
  streaming: 8,
};

function parseTs(iso: string | undefined, fallback: number): number {
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

/** A tool/memory step in the shape shared by a live `trace` event and a persisted
 *  `role:'tool'` step message — so ONE builder ({@link stepNode}) covers both. */
interface StepLike {
  category: string;
  label: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
}

/** Identity of a step across the live trace and its durable persisted copy: same
 *  category + label + client timestamp. Lets a step that exists in BOTH render once
 *  (dedup), while a prior run's step — present only in the messages — still shows. */
function stepSig(category: string, label: string, tsIso: string | undefined): string {
  return `${category}|${label}|${tsIso ?? ''}`;
}

/** Build the timeline node for a tool/memory step (shared by the trace and the
 *  persisted-message paths). Returns null for a category that isn't a step node. */
function stepNode(step: StepLike, ts: number, key: string): TimelineNode | null {
  switch (step.category) {
    case 'tool':
      return { key, kind: 'tool', ts, order: ORDER.tool, label: step.label, args: step.args, result: step.result, isError: !!step.isError, durationMs: step.durationMs };
    case 'error':
      return { key, kind: 'error', ts, order: ORDER.error, label: step.label, message: typeof step.result === 'string' ? step.result : JSON.stringify(step.result ?? '') };
    case 'recall': {
      const r = (step.result ?? {}) as { count?: number; version?: number; items?: EvermindRecallItem[] };
      return { key, kind: 'recall', ts, order: ORDER.recall, version: typeof r.version === 'number' ? r.version : 0, count: typeof r.count === 'number' ? r.count : (Array.isArray(r.items) ? r.items.length : 0), items: Array.isArray(r.items) ? r.items : [] };
    }
    case 'learn': {
      const r = (step.result ?? {}) as { version?: number };
      return { key, kind: 'learn', ts, order: ORDER.learn, version: typeof r.version === 'number' ? r.version : 0 };
    }
    case 'reconcile': {
      const r = (step.result ?? {}) as { count?: number; version?: number };
      return { key, kind: 'reconcile', ts, order: ORDER.reconcile, version: typeof r.version === 'number' ? r.version : 0, count: typeof r.count === 'number' ? r.count : 0 };
    }
    default:
      return null;
  }
}

/** Parse a persisted `role:'tool'` step message's metadata (`{ kind:'step', … }`)
 *  into a {@link StepLike} + its client timestamp, or null when it isn't a step. */
function parseStepMessage(metadata: string | null): { step: StepLike; tsIso?: string } | null {
  if (!metadata) return null;
  try {
    const m = JSON.parse(metadata) as { kind?: string; category?: string; label?: string; args?: unknown; result?: unknown; isError?: boolean; durationMs?: number; ts?: string };
    if (m.kind !== 'step' || typeof m.category !== 'string') return null;
    return {
      step: { category: m.category, label: typeof m.label === 'string' ? m.label : m.category, args: m.args, result: m.result, isError: m.isError, durationMs: m.durationMs },
      tsIso: typeof m.ts === 'string' ? m.ts : undefined,
    };
  } catch {
    return null;
  }
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
    if (ev.category !== 'llm' && ev.category !== 'message') traceStepSigs.add(stepSig(ev.category, ev.label, ev.ts));
  }

  messages.forEach((message, i) => {
    const ts = parseTs(message.createdAt, i);
    if (message.role === 'user') {
      const atts = attachmentsOf(message);
      const images: TimelineImage[] = atts
        .filter((a) => a.imageUrl)
        .map((a) => ({ url: a.imageUrl as string, name: a.name }));
      const imageNames = new Set(images.map((im) => im.name).filter((n): n is string => !!n));
      nodes.push({
        key: `msg-${message.id}`,
        kind: 'user',
        ts,
        order: ORDER.user,
        message,
        text: stripImageRefs(message.content, imageNames),
        images,
      });
    } else if (isStepMessage(message)) {
      // A durable tool/memory STEP row — reconstruct its timeline node so it survives
      // a reload. Skip when the live trace already carries this exact step (dedup), or
      // when the metadata isn't a step (never render a tool row as an assistant bubble).
      const parsed = parseStepMessage(message.metadata);
      if (!parsed) return;
      if (traceStepSigs.has(stepSig(parsed.step.category, parsed.step.label, parsed.tsIso))) return;
      const node = stepNode(parsed.step, parseTs(parsed.tsIso, ts), `msg-${message.id}`);
      if (node) nodes.push(node);
    } else {
      nodes.push({
        key: `msg-${message.id}`,
        kind: 'assistant',
        ts,
        order: ORDER.assistant,
        message,
        text: message.content,
      });
    }
  });

  let step = 0;
  trace.forEach((ev, i) => {
    const ts = parseTs(ev.ts, 1e15 + i); // unparseable trace sorts after dated content
    if (ev.category === 'llm') {
      // "Thought for Xs" = time-to-first-token when the loop captured it (the
      // latency before the model started answering), falling back to the full
      // turn duration for older traces that predate ttftMs.
      nodes.push({ key: `trace-${i}`, kind: 'thinking', ts, order: ORDER.thinking, durationMs: ev.ttftMs ?? ev.durationMs, step: step++ });
    } else if (ev.category === 'message') {
      // 'message' trace events are intentionally dropped — the durable assistant
      // message already renders that text.
    } else {
      const node = stepNode(
        { category: ev.category, label: ev.label, args: ev.args, result: ev.result, isError: ev.isError, durationMs: ev.durationMs },
        ts,
        `trace-${i}`,
      );
      if (node) nodes.push(node);
    }
  });

  // Stable chronological sort: timestamp, then per-kind order, then insertion.
  nodes.sort((a, b) => a.ts - b.ts || a.order - b.order);

  return nodes;
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
