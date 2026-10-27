/**
 * The Brain's binding of `@seanhogg/builderforce-memory/handoff` — fit a working
 * transcript into the window of the model about to serve it (PRD 34 §3.4). This folder
 * is the WINDOW FIT: it re-packs the transcript for a smaller (or different) model. It is
 * not the plan→code role hand-off (`@builderforce/run-policy`) nor the `hand_off` tool
 * (`planHandoff.ts`), which decide WHO serves — this only makes the request fit them.
 *
 * The packer is the memory package's; this module only supplies what is the Brain's:
 *
 *   - `summarize` — the run's own middle summarizer (`summarizeMiddle`, the one auto-
 *     compaction folds with), so a hand-off note reads like a compaction note;
 *   - `recall` — the run's Evermind recall for the latest directive, rendered by
 *     `formatEvermindMemoryBlock` exactly as the pre-turn recall is;
 *   - the budget inputs — the advertised tool schemas and the request's output reserve,
 *     sized by the shared `@builderforce/run-policy` helpers every host packs with, and
 *     (cost PRD C9) the `to` model's long-context price boundary;
 *   - the `llm.handoff` trace, through the caller's hook.
 *
 * {@link createHandoffFit} wraps it as the per-attempt `fit` a local-first host lends
 * `createLocalFirstStream` (its public name is kept: every host lends it by that name).
 */

import { defaultEstimateTokens, handoffBudget, packHandoff, type HandoffMessage, type HandoffPack } from '@seanhogg/builderforce-memory/handoff';
import { formatEvermindMemoryBlock, type EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import { isCostLeverOn } from '@builderforce/cost-levers';
import { priceTierBoundary } from '@builderforce/model-catalog';
import { handoffReserveTokens, handoffTokenBudget, toolSchemaTokens as schemaTokens } from '@builderforce/run-policy';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { summarizeMiddle, type SummaryStreamFn } from '../transcriptSummarizer';
import type { LocalAttemptFit } from '../localFirstTransport';
import { packMemoOf, reusePack, type PackMemo } from './packMemo';

/** Ceiling on each of the summarize / recall calls — a hand-off never waits longer. */
export const DEFAULT_HANDOFF_TIMEOUT_MS = 20_000;

/** The `llm.handoff` trace payload. */
export interface WindowFitTrace {
  from?: string;
  to: string;
  dropped: number;
  summarized: boolean;
  recalled: boolean;
  estimatedTokens: number;
  fits: boolean;
}

/** The summarizer the note may use: the run's stream, the model that writes it, Stop. */
export interface WindowFitSummarizer {
  stream: SummaryStreamFn;
  model?: string;
  signal?: AbortSignal;
}

/** An Evermind recall — structurally `EvermindRunHooks['recall']`. */
export type WindowFitRecall = (query: string) => Promise<EvermindRecallResult | null>;

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
  summarizer?: WindowFitSummarizer;
  recall?: WindowFitRecall;
  timeoutMs?: number;
  onTrace?: (trace: WindowFitTrace) => void;
}

export interface PackForModelResult {
  messages: ChatCompletionMessage[];
  pack: HandoffPack;
}

/** Estimated tokens the advertised tool schemas cost, by the packer's own estimate. */
export function toolSchemaTokens(tools: readonly unknown[] | undefined): number {
  return schemaTokens(tools, defaultEstimateTokens);
}

/**
 * The window the packer fills for `to`: its context window, capped (cost PRD C9, lever
 * `c9_price_tier_budget`) so the packed INPUT stays under the model's lowest long-context
 * price boundary. The packer takes the reply reserve back off this, so the cap is the
 * boundary plus that reserve. A flat-priced model packs to its window exactly. The Brain
 * runs in a browser with no env and no tenant, so only a fully-on lever applies.
 */
function packTargetTokens(to: string, contextTokens: number, reserve: number): number {
  const boundary = isCostLeverOn(undefined, 'c9_price_tier_budget', null) ? priceTierBoundary(to) : undefined;
  const budget = handoffTokenBudget({ contextWindow: contextTokens, reserveOutputTokens: reserve, priceTierBoundary: boundary });
  return budget === undefined ? contextTokens : Math.min(contextTokens, budget + reserve);
}

/**
 * The token budget {@link packForModel} packs `messages` into for these inputs — the
 * packer's own `handoffBudget` over the same target, reply reserve and tool schemas — so
 * a caller can check a memoised pack still fits without re-packing (`packMemo.ts`).
 */
export function packBudgetTokens(input: Pick<PackForModelInput, 'to' | 'contextTokens' | 'tools' | 'maxTokens'>): number {
  const reserve = handoffReserveTokens(input.maxTokens);
  return handoffBudget({
    targetContextTokens: packTargetTokens(input.to, input.contextTokens, reserve),
    reserveOutputTokens: reserve,
    toolsTokens: toolSchemaTokens(input.tools),
  });
}

/** A `recall` callback for the packer: the run's recall rendered as the memory block. */
function recallBlock(recall: WindowFitRecall): (query: string, budgetChars: number) => Promise<string> {
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
  const reserve = handoffReserveTokens(input.maxTokens);
  const pack = await packHandoff({
    messages: input.messages,
    targetContextTokens: packTargetTokens(input.to, input.contextTokens, reserve),
    reserveOutputTokens: reserve,
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
  // Kept messages are the input's own objects; the one note is a plain string whose role
  // the packer alternates against the turn after it (`user` before an assistant turn).
  return { messages: pack.messages as ChatCompletionMessage[], pack };
}

/** Conversations whose last pack {@link createHandoffFit} remembers at once. */
export const HANDOFF_FIT_MEMOS = 16;

/** What a host may lend {@link createHandoffFit}. */
export interface HandoffFitOptions {
  summarizer?: WindowFitSummarizer;
  recall?: WindowFitRecall;
  timeoutMs?: number;
  onTrace?: (trace: WindowFitTrace) => void;
}

/**
 * The per-attempt `fit` for `createLocalFirstStream`: pack the call for the local model
 * about to take it. A target whose window is unknown gets the messages untouched. The
 * last pack per (conversation, model, window) is memoised (`packMemo.ts`) and reused —
 * the turns since appended — until it overflows, so a local model is not re-packed and
 * re-summarized on every call of a conversation. Keyed by the CONVERSATION too: the fit
 * is one per host process, and two chats on one local model must not overwrite each
 * other's pack. At most {@link HANDOFF_FIT_MEMOS} are kept, least recently used first out.
 */
export function createHandoffFit(options: HandoffFitOptions = {}): LocalAttemptFit {
  const packs = new Map<string, PackMemo>();
  const remember = (key: string, memo: PackMemo): void => {
    packs.delete(key);
    packs.set(key, memo);
    while (packs.size > HANDOFF_FIT_MEMOS) packs.delete(packs.keys().next().value!);
  };
  return async (messages, target) => {
    if (!target.contextTokens) return messages;
    const fitInput = {
      to: target.ref,
      contextTokens: target.contextTokens,
      ...(target.tools ? { tools: target.tools } : {}),
      ...(target.maxTokens ? { maxTokens: target.maxTokens } : {}),
    };
    const key = `${target.conversation ?? '-'}|${target.ref}|${target.contextTokens}`;
    const memo = packs.get(key);
    const reused = memo ? reusePack(memo, messages, packBudgetTokens(fitInput)) : null;
    if (reused) {
      // Refresh recency only: the memo itself is the pack the reuse extends.
      remember(key, memo!);
      return reused;
    }
    const { messages: packed, pack } = await packForModel({ messages, ...fitInput, ...options });
    if (pack.fits) remember(key, packMemoOf(messages, packed));
    else packs.delete(key);
    return packed;
  };
}
