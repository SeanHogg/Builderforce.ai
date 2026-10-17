/**
 * The run loop's hand-off gate — decides, before each model request, whether the
 * working transcript must be re-packed for the model about to serve it, and does so.
 *
 * A request is packed when the model it asks for differs from the one that served the
 * last turn (a plan→code re-ask, a stall failover, a transport retry onto another
 * model, a local pin after a cloud turn) OR when that model's known window is smaller
 * than the working budget (a pinned 4k WebLLM model every turn). A request that names
 * no model (auto-routing) is fitted by the gateway, and a model whose window nobody
 * knows keeps today's budget: both pass through untouched.
 *
 * Kept out of `brainRunStore.ts`: the run store supplies the summarizer, the recall and
 * the trace hook; this module owns the decision and the `llm.handoff` step.
 */

import type { EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import type { BrainTraceEvent } from '../brainTriage';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { contextWindowOf, type ModelWindowSources } from './modelWindow';
import { packForModel, type HandoffRecall, type HandoffSummarizer, type HandoffTrace } from './packForModel';

export interface RunHandoffDeps {
  /** The tokens the working transcript is built to (`HISTORY_TOKEN_BUDGET`). */
  workingBudgetTokens: number;
  /** Read per request: the summarizing model follows the run policy. */
  summarizer?: () => HandoffSummarizer;
  /** The run's Evermind recall, when the host injected one. */
  recall?: HandoffRecall;
  /** The recall the run already made before turn 1 — reused, never re-fetched. */
  priorRecall?: { query: string; result: EvermindRecallResult | null };
  windowSources?: ModelWindowSources;
  /** The run's trace hook (`pushTrace`, bound to the cell). */
  trace: (event: BrainTraceEvent) => void;
  now: () => string;
}

export interface RunHandoffRequest {
  messages: ChatCompletionMessage[];
  /** The model the request asks for; undefined = the gateway routes. */
  model?: string;
  tools?: readonly unknown[];
  maxTokens?: number;
  step: number;
}

export interface RunHandoff {
  /** The messages to send for this request — packed when the gate says so. */
  prepare(request: RunHandoffRequest): Promise<ChatCompletionMessage[]>;
  /** Record the model that actually served a turn. */
  served(model: string | undefined): void;
}

/** The `llm.handoff` timeline step. Pure: the caller stamps `ts`. */
export function handoffTrace(ts: string, step: number, t: HandoffTrace): BrainTraceEvent {
  const how = t.summarized ? 'summarized' : t.recalled ? 'recalled from memory' : 'elided';
  return {
    ts,
    category: 'message',
    label: 'llm.handoff',
    args: { step, ...t },
    result: t.dropped > 0
      ? `Packed the transcript for ${t.to}${t.from ? ` (from ${t.from})` : ''}: ${t.dropped} earlier message(s) ${how}, ~${t.estimatedTokens} tokens${t.fits ? '' : ' — still over its window'}.`
      : `Handed the transcript to ${t.to}${t.from ? ` (from ${t.from})` : ''} verbatim, ~${t.estimatedTokens} tokens.`,
  };
}

export function createRunHandoff(deps: RunHandoffDeps): RunHandoff {
  let lastServed: string | undefined;
  // One recall per directive for the whole run; the pre-turn recall seeds it.
  const recalls = new Map<string, Promise<EvermindRecallResult | null>>();
  if (deps.priorRecall) recalls.set(deps.priorRecall.query, Promise.resolve(deps.priorRecall.result));
  const recall: HandoffRecall | undefined = deps.recall
    ? (query) => {
        let hit = recalls.get(query);
        if (!hit) {
          hit = deps.recall!(query).catch(() => null);
          recalls.set(query, hit);
        }
        return hit;
      }
    : undefined;

  return {
    async prepare(req) {
      const to = req.model;
      if (!to) return req.messages;
      const window = contextWindowOf(to, deps.windowSources);
      if (window === undefined) return req.messages;
      const differs = lastServed !== undefined && lastServed !== to;
      if (!differs && window >= deps.workingBudgetTokens) return req.messages;
      const { messages } = await packForModel({
        messages: req.messages,
        to,
        ...(lastServed ? { from: lastServed } : {}),
        contextTokens: window,
        ...(req.tools ? { tools: req.tools } : {}),
        ...(req.maxTokens ? { maxTokens: req.maxTokens } : {}),
        ...(deps.summarizer ? { summarizer: deps.summarizer() } : {}),
        ...(recall ? { recall } : {}),
        onTrace: (t) => {
          // A pinned small model packs every turn; only a real move or a real cut is news.
          if (differs || t.dropped > 0 || !t.fits) deps.trace(handoffTrace(deps.now(), req.step, t));
        },
      });
      return messages;
    },
    served(model) {
      if (model) lastServed = model;
    },
  };
}
