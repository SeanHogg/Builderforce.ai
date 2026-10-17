/**
 * The Brain's binding of `@seanhogg/builderforce-memory/handoff` — fit a working
 * transcript into the window of the model about to serve it (PRD 34 §3.4).
 *
 * The packer is the memory package's; this module only supplies what is the Brain's:
 *
 *   - `summarize` — the run's own middle summarizer (`summarizeMiddle`, the one auto-
 *     compaction folds with), so a hand-off note reads like a compaction note;
 *   - `recall` — the run's Evermind recall for the latest directive, rendered by
 *     `formatEvermindMemoryBlock` exactly as the pre-turn recall is;
 *   - the budget inputs — the advertised tool schemas and the request's output reserve;
 *   - the `llm.handoff` trace, through the caller's hook.
 *
 * {@link createHandoffFit} wraps it as the per-attempt `fit` a local-first host lends
 * `createLocalFirstStream`.
 */

import { defaultEstimateTokens, packHandoff, type HandoffMessage, type HandoffPack } from '@seanhogg/builderforce-memory/handoff';
import { formatEvermindMemoryBlock, type EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { summarizeMiddle, type SummaryStreamFn } from '../workingTranscript';
import type { LocalAttemptFit } from '../localFirstTransport';

/** Output reserve when the request names no `max_tokens`. */
export const DEFAULT_HANDOFF_RESERVE_TOKENS = 4_096;
/** Ceiling on each of the summarize / recall calls — a hand-off never waits longer. */
export const DEFAULT_HANDOFF_TIMEOUT_MS = 20_000;

/** The `llm.handoff` trace payload. */
export interface HandoffTrace {
  from?: string;
  to: string;
  dropped: number;
  summarized: boolean;
  recalled: boolean;
  estimatedTokens: number;
  fits: boolean;
}

/** The summarizer the note may use: the run's stream, the model that writes it, Stop. */
export interface HandoffSummarizer {
  stream: SummaryStreamFn;
  model?: string;
  signal?: AbortSignal;
}

/** An Evermind recall — structurally `EvermindRunHooks['recall']`. */
export type HandoffRecall = (query: string) => Promise<EvermindRecallResult | null>;

export interface PackForModelInput {
  messages: ChatCompletionMessage[];
  /** The model about to serve (its ref), and the one that served last. */
  to: string;
  from?: string;
  /** The `to` model's context window, in tokens. */
  contextTokens: number;
  /** The tool schemas this request advertises. */
  tools?: readonly unknown[];
  /** The request's `max_tokens` — held back for the reply. */
  maxTokens?: number;
  summarizer?: HandoffSummarizer;
  recall?: HandoffRecall;
  timeoutMs?: number;
  onTrace?: (trace: HandoffTrace) => void;
}

export interface PackForModelResult {
  messages: ChatCompletionMessage[];
  pack: HandoffPack;
}

/** Estimated tokens the advertised tool schemas cost. */
export function toolSchemaTokens(tools: readonly unknown[] | undefined): number {
  return tools && tools.length > 0 ? defaultEstimateTokens(JSON.stringify(tools)) : 0;
}

/** A `recall` callback for the packer: the run's recall rendered as the memory block. */
function recallBlock(recall: HandoffRecall): (query: string, budgetChars: number) => Promise<string> {
  return async (query, budgetChars) => {
    const result = await recall(query);
    if (!result?.seeded || result.items.length === 0) return '';
    return formatEvermindMemoryBlock(result.items).slice(0, budgetChars);
  };
}

/** Pack `messages` for the `to` model's window. Never throws for a failing summarizer
 *  or recall — the packer falls through to the next note source. */
export async function packForModel(input: PackForModelInput): Promise<PackForModelResult> {
  const summarizer = input.summarizer;
  const pack = await packHandoff({
    messages: input.messages,
    targetContextTokens: input.contextTokens,
    reserveOutputTokens: input.maxTokens && input.maxTokens > 0 ? input.maxTokens : DEFAULT_HANDOFF_RESERVE_TOKENS,
    toolsTokens: toolSchemaTokens(input.tools),
    ...(input.from ? { from: input.from } : {}),
    to: input.to,
    ...(summarizer
      ? {
          summarize: async (dropped: readonly HandoffMessage[]) =>
            (await summarizeMiddle(summarizer.stream, summarizer.model, dropped as ChatCompletionMessage[], summarizer.signal)) ?? '',
        }
      : {}),
    ...(input.recall ? { recall: recallBlock(input.recall) } : {}),
    timeoutMs: input.timeoutMs ?? DEFAULT_HANDOFF_TIMEOUT_MS,
  });
  input.onTrace?.({
    ...(input.from ? { from: input.from } : {}),
    to: input.to,
    dropped: pack.dropped,
    summarized: pack.summarized,
    recalled: pack.recalled,
    estimatedTokens: pack.estimatedTokens,
    fits: pack.fits,
  });
  // Kept messages are the input's own objects; the one note is a plain assistant string.
  return { messages: pack.messages as ChatCompletionMessage[], pack };
}

/** What a host may lend {@link createHandoffFit}. */
export interface HandoffFitOptions {
  summarizer?: HandoffSummarizer;
  recall?: HandoffRecall;
  timeoutMs?: number;
  onTrace?: (trace: HandoffTrace) => void;
}

/**
 * The per-attempt `fit` for `createLocalFirstStream`: pack the call for the local model
 * about to take it. A target whose window is unknown gets the messages untouched.
 */
export function createHandoffFit(options: HandoffFitOptions = {}): LocalAttemptFit {
  return async (messages, target) => {
    if (!target.contextTokens) return messages;
    const { messages: packed } = await packForModel({
      messages,
      to: target.ref,
      contextTokens: target.contextTokens,
      ...(target.tools ? { tools: target.tools } : {}),
      ...(target.maxTokens ? { maxTokens: target.maxTokens } : {}),
      ...options,
    });
    return packed;
  };
}
