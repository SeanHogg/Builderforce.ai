import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';

/**
 * Brain activity narration — what to SAY while Brain works, and what it cost.
 *
 * Users told us they do not want to read every execution step, but they do want to
 * know the turn is alive, roughly what it is doing, what it is spending, and how
 * long it took once it lands. This derives all of that from the live trace so the
 * compact status strip and the full step list are driven by the SAME signal — the
 * step list is then only a disclosure of detail, never a different story.
 *
 * Pure and time-injected so every phase, count, and duration is deterministic and
 * testable.
 */

export type BrainActivityPhaseId =
  | 'thinking'
  | 'processing'
  | 'designing'
  | 'churning'
  | 'composing'
  | 'recalling'
  | 'executing'
  | 'learning'
  | 'writing';

export interface BrainActivityPhase {
  id: BrainActivityPhaseId;
  /** Humanized tool name shown after the phase word, when the trace named one. */
  detail?: string;
}

/**
 * Before any step is recorded there is nothing to report but elapsed time, so the
 * wording rotates instead of freezing on one word — a frozen label reads as a hang.
 */
const IDLE_CYCLE: readonly BrainActivityPhaseId[] = ['thinking', 'processing', 'churning', 'designing', 'composing'];
export const BRAIN_ACTIVITY_CYCLE_MS = 2_500;

/** `builtin_tasks_create` / `canvas.add_object` → `tasks create` / `add object`. */
export function humanizeTraceLabel(label: string): string {
  return label
    .replace(/^(?:builtin|canvas)[_.]/, '')
    .replaceAll('_', ' ')
    .replaceAll('.', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The phase to narrate for a run that is still in flight.
 *
 * @param trace     Steps recorded so far, oldest first.
 * @param elapsedMs Milliseconds since the turn started (drives the idle rotation).
 */
export function brainActivityPhase(trace: readonly BrainTraceEvent[], elapsedMs: number): BrainActivityPhase {
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const event = trace[index]!;
    if (event.category === 'error') continue;
    if (event.category === 'tool') return { id: 'executing', detail: humanizeTraceLabel(event.label) };
    if (event.category === 'recall') return { id: 'recalling' };
    if (event.category === 'learn' || event.category === 'reconcile') return { id: 'learning' };
    if (event.category === 'message') return { id: 'writing' };
    return { id: 'processing' };
  }
  const step = Math.floor(Math.max(0, elapsedMs) / BRAIN_ACTIVITY_CYCLE_MS) % IDLE_CYCLE.length;
  return { id: IDLE_CYCLE[step]! };
}

/**
 * Tokens the gateway has reported for this run so far.
 *
 * `total` is preferred when present; otherwise prompt + completion are summed, so a
 * provider that reports only the split still contributes an honest number. Steps
 * with no usage at all are skipped rather than counted as zero.
 */
export function brainActivityTokens(trace: readonly BrainTraceEvent[]): number {
  return trace.reduce((total, event) => {
    const usage = event.usage;
    if (!usage) return total;
    if (typeof usage.total === 'number' && Number.isFinite(usage.total)) return total + usage.total;
    const prompt = typeof usage.prompt === 'number' && Number.isFinite(usage.prompt) ? usage.prompt : 0;
    const completion = typeof usage.completion === 'number' && Number.isFinite(usage.completion) ? usage.completion : 0;
    return total + prompt + completion;
  }, 0);
}

/** How many tool steps ran this turn — the "executed N actions" half of the receipt. */
export function brainActivityToolCount(trace: readonly BrainTraceEvent[]): number {
  return trace.filter((event) => event.category === 'tool').length;
}

/** `1_234` → `1.2k`. Compact because it sits inline in a one-line status strip. */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 1_000_000) {
    const thousands = tokens / 1_000;
    return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
  }
  const millions = tokens / 1_000_000;
  return `${millions < 10 ? millions.toFixed(1) : Math.round(millions)}M`;
}

/** `52_400` → `52s`; `74_000` → `1m 14s`. Matches the transcript's duration wording. */
export function formatElapsed(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export interface BrainRunSummary {
  durationMs: number;
  tokens: number;
  toolCount: number;
}

/**
 * The receipt shown after a turn settles — "Thought for 52s · 1.2k tokens".
 *
 * Returns null for a run that produced nothing measurable, so a trivial or
 * cached turn does not leave a meaningless badge behind.
 */
export function brainRunSummary(trace: readonly BrainTraceEvent[], durationMs: number): BrainRunSummary | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  return { durationMs, tokens: brainActivityTokens(trace), toolCount: brainActivityToolCount(trace) };
}
