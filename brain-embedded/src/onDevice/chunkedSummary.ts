/**
 * Chunked summaries (PRD 42 · B3): a small window takes a long transcript.
 *
 * The algorithm (split on paragraph / line boundaries, summarize each chunk, merge while still over
 * budget, give up past `MAX_SUMMARY_CHUNKS` leaf chunks) is memory's `chunkedTextSummary`
 * (`@seanhogg/builderforce-memory/working`). This file only binds it to the on-device task contract:
 * the session's {@link InputBudget}, the {@link CHUNK_BUDGET_SHARE} headroom and the chunk cap, plus the
 * summary-call reserve ({@link summaryReserveTokens}).
 */

import { chunkedTextSummary } from '@seanhogg/builderforce-memory/working';
import { approxTokens, type InputBudget } from '../builtInAi/taskSession';
import type { SummarizeOptions } from './onDeviceTasks';
import { summarizePrompt } from './taskPrompts';
import { CHUNK_BUDGET_SHARE, MAX_SUMMARY_CHUNKS } from './taskRoutes';

export interface ChunkedSummaryInput {
  text: string;
  budget: Pick<InputBudget, 'limit' | 'measure'>;
  /** Summarizes one in-window piece; null = the device declined. */
  summarizeChunk(chunk: string): Promise<string | null>;
  /** Tokens each call spends outside the chunk (instruction + expected reply); see {@link summaryReserveTokens}. */
  reserveTokens?: number;
  signal?: AbortSignal;
}

/** Output allowance when the caller names no word cap. */
const DEFAULT_OUTPUT_TOKENS = 512;

/** Tokens a summary call spends outside the chunk: the instruction plus the expected reply. */
export function summaryReserveTokens(o: SummarizeOptions): number {
  const expectedOutput = o.maxWords ? Math.ceil(o.maxWords * 1.5) : DEFAULT_OUTPUT_TOKENS;
  return approxTokens(summarizePrompt('', o).system) + expectedOutput;
}

export function chunkedSummary(input: ChunkedSummaryInput): Promise<string | null> {
  const { text, budget, summarizeChunk, reserveTokens, signal } = input;
  return chunkedTextSummary({
    text,
    limit: budget.limit,
    measure: (t, s) => budget.measure(t, s),
    summarizeChunk: (chunk) => summarizeChunk(chunk),
    maxChunks: MAX_SUMMARY_CHUNKS,
    budgetShare: CHUNK_BUDGET_SHARE,
    reserveTokens,
    signal,
  });
}
