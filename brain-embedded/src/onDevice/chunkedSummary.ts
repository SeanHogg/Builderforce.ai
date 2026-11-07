/**
 * Chunked summaries (PRD 42 · B3): a small window takes a long transcript.
 *
 *   1. measure the budget (the session's own measure, else ≈4 chars/token upstream);
 *   2. split on message / paragraph boundaries into chunks under 80% of the window;
 *   3. summarize each chunk with the same instruction;
 *   4. summarize the concatenated summaries, recursing while that is still over budget;
 *   5. past `MAX_SUMMARY_CHUNKS` leaf chunks → null (the caller's existing path takes it).
 *
 * Pure over an injected budget and an injected one-chunk summarizer: it knows no API.
 */

import { approxTokens, throwIfAborted, type InputBudget } from '../builtInAi/taskSession';
import type { SummarizeOptions } from './onDeviceTasks';
import { summarizePrompt } from './taskPrompts';
import { CHUNK_BUDGET_SHARE, MAX_SUMMARY_CHUNKS } from './taskRoutes';

/** Merging summaries must shrink the text; this bounds a pathological recursion. */
const MAX_MERGE_DEPTH = 3;
/** Bounds the re-measure/re-split of a chunk the first estimate under-cut. */
const MAX_REFIT_ATTEMPTS = 3;

export interface ChunkedSummaryInput {
  text: string;
  budget: Pick<InputBudget, 'limit' | 'measure'>;
  /** Summarizes one in-window piece; null = the device declined. */
  summarizeChunk(chunk: string): Promise<string | null>;
  /** Tokens each call spends outside the chunk (instruction + expected reply); see {@link summaryReserveTokens}. */
  reserveTokens?: number;
  signal?: AbortSignal;
}

/** Separators from the coarsest boundary to the finest; past the last, a hard cut. */
const SEPARATORS = ['\n\n', '\n'] as const;

/**
 * Cut `text` into pieces of at most `maxChars`: paragraphs first, then lines, then a hard
 * cut. A piece still over `maxChars` moves to the NEXT level only, so every recursion
 * strictly descends and the split terminates; the separator stays on its piece, so
 * joining the pieces gives back `text`.
 */
function pieces(text: string, maxChars: number, level = 0): string[] {
  if (text.length <= maxChars) return [text];
  const separator = SEPARATORS[level];
  if (separator === undefined) {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) out.push(text.slice(i, i + maxChars));
    return out;
  }
  const parts = text.split(separator);
  if (parts.length === 1) return pieces(text, maxChars, level + 1);
  return parts.flatMap((p, i) => pieces(i < parts.length - 1 ? p + separator : p, maxChars, level + 1));
}

/** Pack pieces greedily into chunks no longer than `maxChars`. */
function pack(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces(text, maxChars)) {
    if (current && current.length + piece.length > maxChars) {
      chunks.push(current);
      current = '';
    }
    current += piece;
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

/** Output allowance when the caller names no word cap. */
const DEFAULT_OUTPUT_TOKENS = 512;

/** Tokens a summary call spends outside the chunk: the instruction plus the expected reply. */
export function summaryReserveTokens(o: SummarizeOptions): number {
  const expectedOutput = o.maxWords ? Math.ceil(o.maxWords * 1.5) : DEFAULT_OUTPUT_TOKENS;
  return approxTokens(summarizePrompt('', o).system) + expectedOutput;
}

/** Re-measure each chunk with the real measure; a chunk still over `limit` is split again (bounded). */
async function fitChunks(chunks: string[], limit: number, input: ChunkedSummaryInput): Promise<string[]> {
  const out: string[] = [];
  for (const chunk of chunks) {
    let parts = [chunk];
    for (let attempt = 0; attempt < MAX_REFIT_ATTEMPTS; attempt++) {
      const next: string[] = [];
      let over = false;
      for (const part of parts) {
        throwIfAborted(input.signal);
        const tokens = await input.budget.measure(part, input.signal);
        if (tokens <= limit || part.length <= 1) { next.push(part); continue; }
        over = true;
        next.push(...pack(part, Math.max(1, Math.floor(((part.length / tokens) * limit) * 0.9))));
      }
      parts = next;
      if (!over) break;
    }
    out.push(...parts);
  }
  return out;
}

export async function chunkedSummary(input: ChunkedSummaryInput, depth = 0): Promise<string | null> {
  const { text, budget, signal } = input;
  throwIfAborted(signal);
  // The reserve never takes more than half the window, so a tiny window still holds a chunk.
  const room = Math.max(Math.floor(budget.limit / 2), budget.limit - (input.reserveTokens ?? 0));
  const limit = Math.max(1, Math.floor(room * CHUNK_BUDGET_SHARE));
  const tokens = await budget.measure(text, signal);
  if (tokens <= limit) return input.summarizeChunk(text);
  if (depth >= MAX_MERGE_DEPTH) return null;

  const chunks = await fitChunks(pack(text, Math.max(1, Math.floor((text.length / tokens) * limit))), limit, input);
  if (chunks.length > MAX_SUMMARY_CHUNKS) return null;

  const summaries: string[] = [];
  for (const chunk of chunks) {
    throwIfAborted(signal);
    const summary = await input.summarizeChunk(chunk);
    if (summary === null) return null;
    summaries.push(summary);
  }
  const merged = summaries.join('\n\n');
  // A merge that did not shrink the text will not converge.
  if (merged.length >= text.length) return null;
  return chunkedSummary({ ...input, text: merged }, depth + 1);
}
