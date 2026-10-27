/**
 * THE mention budget — how much of a file the person put in front of the model (an
 * attached text file, "Add context", a `#file` reference) is inlined into the turn, and
 * how it is cut when it costs too much.
 *
 * A mention is paid for on EVERY later turn (it sits in the transcript), so it gets a
 * per-file cap and a per-turn total cap, both in chars. The cloud row is fixed; the
 * local row follows the local model's window when the host knows it — a 8K-token model
 * cannot be handed what a frontier model can. A cut is never silent: the block says
 * which file was cut and how much of it the model was shown.
 *
 * Pure: no I/O. Compression (prose only) is the caller's step, before fitting.
 */

import { MIN_KEEP_CHARS, TOOL_RESULT_CHARS_PER_TOKEN } from './caps.js';

/** Where the turn is answered: a cloud model, or a model on this machine. */
export type MentionTarget = 'cloud' | 'local';

/** Char caps for the mentions of ONE turn. */
export interface MentionBudget {
  /** The most one file may contribute. */
  perFileChars: number;
  /** The most every mention of the turn may contribute together. */
  totalChars: number;
}

/** The cloud row: ~12K tokens a file, ~24K tokens a turn. */
export const CLOUD_MENTION_BUDGET: Readonly<MentionBudget> = { perFileChars: 48_000, totalChars: 96_000 };

/** The local row when the model's window is unknown: sized for an ~8K-token model. */
export const LOCAL_MENTION_BUDGET: Readonly<MentionBudget> = { perFileChars: 6_000, totalChars: 10_000 };

/** Share of a known local window the turn's mentions may take. */
export const LOCAL_MENTION_WINDOW_SHARE = 0.3;

export interface MentionBudgetOptions {
  /** The serving model's context window (tokens), when known. Used for `local`. */
  contextWindowTokens?: number;
}

/**
 * The budget for a turn answered by `target`. `local` with a known window takes
 * {@link LOCAL_MENTION_WINDOW_SHARE} of it (never above the cloud row, never below
 * {@link MIN_KEEP_CHARS}); a single file may take at most two thirds of that.
 */
export function mentionBudget(target: MentionTarget, opts: MentionBudgetOptions = {}): MentionBudget {
  if (target === 'cloud') return { ...CLOUD_MENTION_BUDGET };
  const window = opts.contextWindowTokens;
  if (typeof window !== 'number' || !Number.isFinite(window) || window <= 0) return { ...LOCAL_MENTION_BUDGET };
  const total = Math.max(
    MIN_KEEP_CHARS,
    Math.min(CLOUD_MENTION_BUDGET.totalChars, Math.floor(window * LOCAL_MENTION_WINDOW_SHARE) * TOOL_RESULT_CHARS_PER_TOKEN),
  );
  return { totalChars: total, perFileChars: Math.max(MIN_KEEP_CHARS, Math.min(CLOUD_MENTION_BUDGET.perFileChars, Math.floor((total * 2) / 3))) };
}

/** One piece of text the person mentioned. */
export interface Mention {
  /** What it is called in the turn — a workspace-relative path or a file name. */
  name: string;
  text: string;
  /** A short note for the block's header, e.g. that it was compressed. */
  note?: string;
}

/** A mention after the budget: what the model is shown of it. */
export interface FittedMention extends Mention {
  /** Chars of the original text. */
  originalChars: number;
  /** Chars of it the model is shown (0 = omitted: the turn's budget was spent). */
  keptChars: number;
  truncated: boolean;
}

/** The marker after a cut — names the file and how much of it the model saw. */
export function mentionCutMarker(name: string, keptChars: number, originalChars: number): string {
  return keptChars <= 0
    ? `[${name} omitted — this turn's attachment budget was already spent (${originalChars.toLocaleString('en-US')} chars). Read the file with a tool if it is needed.]`
    : `[${name} truncated — showing the first ${keptChars.toLocaleString('en-US')} of ${originalChars.toLocaleString('en-US')} chars. Read the file with a tool for the rest.]`;
}

/** The head of `text` within `max` chars, snapped back to a line end when one is near. */
function headOf(text: string, max: number): string {
  if (text.length <= max) return text;
  const nl = text.lastIndexOf('\n', max);
  return text.slice(0, nl > max * 0.8 ? nl : max);
}

/**
 * Fit the turn's mentions to `budget`, in order: each to the per-file cap, then the
 * running total to the turn cap. A mention past the total is kept as an empty entry
 * (`keptChars: 0`) so the model is still told it exists.
 */
export function fitMentions(mentions: readonly Mention[], budget: MentionBudget): FittedMention[] {
  let left = Math.max(0, budget.totalChars);
  return mentions.map((m) => {
    const room = Math.min(Math.max(0, budget.perFileChars), left);
    const text = headOf(m.text, room);
    left -= text.length;
    return { ...m, text, originalChars: m.text.length, keptChars: text.length, truncated: text.length < m.text.length };
  });
}

/** A backtick fence longer than any backtick run inside `text`, so the block cannot end early. */
function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/** The fenced blocks for fitted mentions, each headed by its name; '' for none. */
export function renderMentions(fitted: readonly FittedMention[]): string {
  return fitted
    .map((m) => {
      const header = `Attached file: ${m.name}${m.note ? ` (${m.note})` : ''}`;
      const cut = m.truncated ? `\n${mentionCutMarker(m.name, m.keptChars, m.originalChars)}` : '';
      if (m.keptChars <= 0 && m.originalChars > 0) return `${header}\n${mentionCutMarker(m.name, 0, m.originalChars)}`;
      const fence = fenceFor(m.text);
      return `${header}\n${fence}\n${m.text}\n${fence}${cut}`;
    })
    .join('\n\n');
}

/** {@link fitMentions} then {@link renderMentions} — the turn's inlined block. */
export function inlineMentions(mentions: readonly Mention[], budget: MentionBudget): string {
  return renderMentions(fitMentions(mentions, budget));
}
