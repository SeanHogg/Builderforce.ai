/**
 * The MODEL MOVES a run records — the transcript re-packed for the window of the model
 * about to serve it (`llm.handoff`, brain-embedded's window fit) and a local-first turn
 * that fell over from an on-device model (`llm.local_fallback`) — read from the step's
 * structured args into the line the transcript shows.
 *
 * The step's `result` is the diagnostics sentence (English, for triage and copied
 * reports); the reader's line is composed HERE from the facts, through the
 * `brain.timeline.modelMove*` catalog keys, so it reads in the viewer's language on
 * every surface. Model refs are language-neutral and shown as they are.
 *
 * Pure: no React.
 */

/** One model move, as the transcript renders it. */
export type ModelMove =
  | { kind: 'packed'; from?: string; to: string; dropped: number; how: 'summarized' | 'recalled' | 'elided'; tokens: number; fits: boolean }
  | { kind: 'verbatim'; from?: string; to: string; tokens: number }
  | { kind: 'localFallback'; from: string; to: string };

/** The catalog strings a model-move line is composed from (`brain.timeline.*`). */
export interface ModelMoveLabels {
  /** Must contain `{models}`, `{dropped}`, `{how}` and `{tokens}`. */
  modelMovePacked: string;
  /** Must contain `{models}` and `{tokens}`. */
  modelMoveVerbatim: string;
  /** Appended when the packed transcript still exceeds the window. */
  modelMoveOverWindow: string;
  modelMoveHowSummarized: string;
  modelMoveHowRecalled: string;
  modelMoveHowElided: string;
  /** Must contain `{from}` and `{to}`. */
  modelMoveLocalFallback: string;
  /** Tooltip on a model-move line. */
  modelMoveHint: string;
}

export const DEFAULT_MODEL_MOVE_LABELS: ModelMoveLabels = {
  modelMovePacked: 'Conversation fitted to {models} — {dropped} earlier messages {how}, ~{tokens} tokens',
  modelMoveVerbatim: 'Conversation handed to {models} in full, ~{tokens} tokens',
  modelMoveOverWindow: 'It is still larger than the model’s context window.',
  modelMoveHowSummarized: 'summarized',
  modelMoveHowRecalled: 'replaced by recalled memory',
  modelMoveHowElided: 'left out',
  modelMoveLocalFallback: '{from} on this device could not take this turn — {to} answered it',
  modelMoveHint: 'The run moved to another model, so the conversation was fitted to that model’s context window.',
};

/** The step labels that are model moves. */
export const MODEL_MOVE_STEP_LABELS: readonly string[] = ['llm.handoff', 'llm.local_fallback'];

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The move a step records, or null when the step is not one (or its args are unreadable). */
export function modelMoveOf(label: string, args: unknown): ModelMove | null {
  if (!MODEL_MOVE_STEP_LABELS.includes(label) || !args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  const to = str(a.to);
  if (!to) return null;
  const from = str(a.from);
  if (label === 'llm.local_fallback') return from ? { kind: 'localFallback', from, to } : null;
  const dropped = num(a.dropped);
  if (dropped <= 0) return { kind: 'verbatim', ...(from ? { from } : {}), to, tokens: num(a.estimatedTokens) };
  const how = a.summarized === true ? 'summarized' : a.recalled === true ? 'recalled' : 'elided';
  return { kind: 'packed', ...(from ? { from } : {}), to, dropped, how, tokens: num(a.estimatedTokens), fits: a.fits !== false };
}

/** The reader's line for a move, in the catalog's words. */
export function modelMoveLine(move: ModelMove, labels: ModelMoveLabels): string {
  if (move.kind === 'localFallback') {
    return labels.modelMoveLocalFallback.replace('{from}', move.from).replace('{to}', move.to);
  }
  const models = move.from ? `${move.from} → ${move.to}` : move.to;
  if (move.kind === 'verbatim') {
    return labels.modelMoveVerbatim.replace('{models}', models).replace('{tokens}', String(move.tokens));
  }
  const how = move.how === 'summarized' ? labels.modelMoveHowSummarized : move.how === 'recalled' ? labels.modelMoveHowRecalled : labels.modelMoveHowElided;
  const line = labels.modelMovePacked
    .replace('{models}', models)
    .replace('{dropped}', String(move.dropped))
    .replace('{how}', how)
    .replace('{tokens}', String(move.tokens));
  return move.fits ? line : `${line}. ${labels.modelMoveOverWindow}`;
}
