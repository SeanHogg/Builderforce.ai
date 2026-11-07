/**
 * `OnDeviceTasks` over ANY on-device chat completion (PRD 42 · B2): VS Code binds it to
 * Synapse (`completeOnDevice`), and the web / Rovr port uses it as the tail behind the
 * built-in APIs (bfi / WebLLM through the page fetch shim). The host injects the one
 * completion; this file owns the prompts, the chunking and the validation.
 *
 * `translate` returns null: a chat model's translation is not shown unlabelled, and there
 * is no cloud here (the caller's own fallback takes it). `detectLanguage` is the
 * deterministic `heuristicLanguage`, never the model.
 */

import { conformsToJsonSchema } from '@builderforce/json-schema';
import { approxTokens, nullOnFailure, type InputBudget } from '../builtInAi/taskSession';
import { parseLocalModelRef } from '@builderforce/local-inference';
import { chunkedSummary, summaryReserveTokens } from './chunkedSummary';
import { heuristicLanguage } from './heuristicLanguage';
import { observedTask } from './observedTask';
import { fallbackAfterFailure } from './onDeviceFailure';
import type { JsonTaskOptions, OnDeviceEngine, OnDeviceObserver, OnDeviceTaskKind, OnDeviceTasks, ServedBy, ServedOption } from './onDeviceTasks';
import {
  jsonPrompt, parseJsonReply, proofreadPrompt, rewritePrompt, summarizePrompt, writePrompt, type PromptPair,
} from './taskPrompts';

export interface CompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** A completion on the device only: its text, or null when it declined. Non-abort throws read as null. */
export type OnDeviceCompletion = (
  messages: readonly CompletionMessage[],
  signal?: AbortSignal,
  /** Told the model ref that served it (a review records which model judged). */
  onServed?: (modelRef: string) => void,
) => Promise<string | null>;

export interface CompletionOnDeviceOptions {
  complete: OnDeviceCompletion;
  /** Whether the completion could serve right now (the host's memoized probe). */
  available(): Promise<boolean>;
  /**
   * The engine's input window when known (a function is asked per summary, for a host whose
   * serving model is probed); 4,096 otherwise (the smallest built-in window).
   */
  contextTokens?: number | (() => Promise<number | undefined>);
  /** Told every call's outcome (PRD 42 · Part F). Absent ⇒ nothing is reported. */
  observe?: OnDeviceObserver;
}

export interface CompletionOnDeviceTasks extends OnDeviceTasks {
  /** The raw completion, for callers that parse their own reply (judgement, research). */
  complete: OnDeviceCompletion;
}

const DEFAULT_CONTEXT_TOKENS = 4_096;
const COMPLETION_KINDS: readonly OnDeviceTaskKind[] = ['summarize', 'rewrite', 'write', 'proofread', 'json'];

const ENGINES: ReadonlySet<string> = new Set<OnDeviceEngine>(['browser', 'bfi', 'webllm', 'synapse', 'ollama', 'freetoken']);

/** Who a served model ref (`local/<runtime>/<model>`) is, or null for a ref that is not an on-device engine. */
export function servedByRef(kind: OnDeviceTaskKind, ref: string): ServedBy | null {
  const parsed = parseLocalModelRef(ref);
  return parsed && ENGINES.has(parsed.provider) ? { kind, engine: parsed.provider as OnDeviceEngine, model: parsed.model } : null;
}

export function completionOnDeviceTasks(options: CompletionOnDeviceOptions): CompletionOnDeviceTasks {
  const budgetFor = async (): Promise<Pick<InputBudget, 'limit' | 'measure'>> => {
    const window = typeof options.contextTokens === 'function' ? await options.contextTokens().catch(fallbackAfterFailure('contextTokens', undefined)) : options.contextTokens;
    return { limit: window && window > 0 ? window : DEFAULT_CONTEXT_TOKENS, measure: async (text) => approxTokens(text) };
  };

  const ask = (kind: OnDeviceTaskKind, pair: PromptPair, signal: AbortSignal | undefined, served: (by: ServedBy) => void): Promise<string | null> =>
    nullOnFailure(async () => {
      const reply = await options.complete(
        [{ role: 'system', content: pair.system }, { role: 'user', content: pair.user }],
        signal,
        (ref) => { const by = servedByRef(kind, ref); if (by) served(by); },
      );
      return reply && reply.trim() ? reply.trim() : null;
    }, signal);

  const observed = <R,>(kind: OnDeviceTaskKind, o: ServedOption | undefined, input: string, run: (served: (by: ServedBy) => void) => Promise<R | null>): Promise<R | null> =>
    observedTask({ kind, observe: options.observe, onServed: o?.onServed, input }, run);

  return {
    complete: options.complete,
    available: async () => new Set<OnDeviceTaskKind>([
      ...((await options.available().catch(fallbackAfterFailure('available', false))) ? COMPLETION_KINDS : []),
      'detectLanguage', // deterministic: needs no model
    ]),
    summarize: (text, o) =>
      observed('summarize', o, text, (served) =>
        nullOnFailure(async () => chunkedSummary({
          text,
          budget: await budgetFor(),
          reserveTokens: summaryReserveTokens(o),
          summarizeChunk: (chunk) => ask('summarize', summarizePrompt(chunk, o), o.signal, served),
          ...(o.signal ? { signal: o.signal } : {}),
        }), o.signal)),
    rewrite: (text, o) => observed('rewrite', o, text, (served) => ask('rewrite', rewritePrompt(text, o), o.signal, served)),
    write: (task, o) => observed('write', o, task, (served) => ask('write', writePrompt(task, o), o?.signal, served)),
    proofread: (text, o) => observed('proofread', o, text, (served) => ask('proofread', proofreadPrompt(text), o?.signal, served)),
    detectLanguage: (text, o) => observed('detectLanguage', o, text, async () => heuristicLanguage(text)),
    translate: async () => null,
    json: <T,>(o: JsonTaskOptions): Promise<T | null> =>
      observed<T>('json', o, `${o.system}\n${o.user}`, async (served) => {
        const reply = await ask('json', jsonPrompt(o, true), o.signal, served);
        const value = reply === null ? null : parseJsonReply(reply);
        return value !== null && conformsToJsonSchema(value, o.schema) ? (value as T) : null;
      }),
  };
}
