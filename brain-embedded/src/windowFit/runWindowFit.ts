/**
 * The run loop's window-fit gate — decides, before each model request, whether the
 * working transcript must be re-packed for the window of the model about to serve it,
 * and does so.
 *
 * WHO serves a request is decided elsewhere (the run policy: a plan→code re-ask, a stall
 * failover, a transport retry onto another model, a local pin after a cloud turn); this
 * gate only makes the transcript FIT whoever that is. A request is packed when the model
 * it asks for differs from the one that served the last turn OR when that model's known
 * window is smaller than the working budget (a pinned 4k WebLLM model every turn). A
 * request that names no model (auto-routing) is fitted by the gateway, and a model whose
 * window nobody knows keeps today's budget: both pass through untouched.
 *
 * Kept out of the run store: it supplies the summarizer, the recall, the window sources
 * and the trace hook; this module owns the decision and the `llm.handoff` step.
 */

import type { EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import type { BrainTraceEvent } from '../brainTriage';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { resolveContextWindow, type RunWindowSources } from './modelWindow';
import { packForModel, type WindowFitRecall, type WindowFitSummarizer, type WindowFitTrace } from './packForModel';

export interface RunWindowFitDeps {
  /** The tokens the working transcript is built to (`HISTORY_TOKEN_BUDGET`). */
  workingBudgetTokens: number;
  /** Read per request: the summarizing model follows the run policy. */
  summarizer?: () => WindowFitSummarizer;
  /** The run's Evermind recall, when the host injected one. */
  recall?: WindowFitRecall;
  /** The recall the run already made before turn 1 — reused, never re-fetched. */
  priorRecall?: { query: string; result: EvermindRecallResult | null };
  /** Where a target's window comes from: the host's gateway catalog and live probes. */
  windowSources?: RunWindowSources;
  /** The run's trace hook (`pushTrace`, bound to the cell). */
  trace: (event: BrainTraceEvent) => void;
  now: () => string;
}

export interface RunWindowFitRequest {
  messages: ChatCompletionMessage[];
  /** The model the request asks for; undefined = the gateway routes. */
  model?: string;
  tools?: readonly unknown[];
  maxTokens?: number;
  step: number;
}

export interface RunWindowFit {
  /** The messages to send for this request — packed when the gate says so. */
  prepare(request: RunWindowFitRequest): Promise<ChatCompletionMessage[]>;
  /** Record the model that actually served a turn. */
  served(model: string | undefined): void;
}

/**
 * The `llm.handoff` step. Pure: the caller stamps `ts`. `result` is the diagnostics
 * sentence (triage and copied reports read it); the transcript composes its own line
 * from `args` in the reader's language (brain-ui `windowFit` node).
 */
export function windowFitTrace(ts: string, step: number, t: WindowFitTrace): BrainTraceEvent {
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

/** The step recorded when the hand-off note's memory recall failed — the note falls
 *  through to elision, and the reason is kept rather than swallowed. */
export function windowFitRecallFailedTrace(ts: string, step: number, error: unknown): BrainTraceEvent {
  return {
    ts,
    category: 'message',
    label: 'llm.handoff_recall_failed',
    args: { step },
    result: `The memory recall for the hand-off note failed (${error instanceof Error ? error.message : String(error)}) — the dropped messages were elided instead.`,
  };
}

export function createRunWindowFit(deps: RunWindowFitDeps): RunWindowFit {
  let lastServed: string | undefined;
  // One recall per directive for the whole run; the pre-turn recall seeds it.
  const recalls = new Map<string, Promise<EvermindRecallResult | null>>();
  if (deps.priorRecall) recalls.set(deps.priorRecall.query, Promise.resolve(deps.priorRecall.result));
  /** The recall for one request, its failure recorded against that request's step. */
  const recallFor = (step: number): WindowFitRecall | undefined => deps.recall
    ? (query) => {
        let hit = recalls.get(query);
        if (!hit) {
          hit = deps.recall!(query).catch((error: unknown) => {
            deps.trace(windowFitRecallFailedTrace(deps.now(), step, error));
            return null;
          });
          recalls.set(query, hit);
        }
        return hit;
      }
    : undefined;

  return {
    async prepare(req) {
      const to = req.model;
      if (!to) return req.messages;
      const window = await resolveContextWindow(to, deps.windowSources);
      if (window === undefined) return req.messages;
      const differs = lastServed !== undefined && lastServed !== to;
      if (!differs && window >= deps.workingBudgetTokens) return req.messages;
      const recall = recallFor(req.step);
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
          if (differs || t.dropped > 0 || !t.fits) deps.trace(windowFitTrace(deps.now(), req.step, t));
        },
      });
      return messages;
    },
    served(model) {
      if (model) lastServed = model;
    },
  };
}
