/**
 * The deterministic-first PreFetch gate in the run preamble (docs/design/deterministic-prefetch.md)
 * — the ONE place a Brain run consults `@builderforce/prefetch`, before memory and the model.
 * The pass itself (classify → ANSWER → PREFETCH) is the package's `runGate`, shared with
 * the on-prem preamble; this file is its run-cell glue:
 *
 *   - ANSWER, read  → `adoptAnswerWithoutModel` settles the run (its chips ride the step);
 *   - ANSWER, write → the run's OWN confirm channel (`requestRunConfirm`: the composer's
 *                     confirm chip, declined by Stop) unless the host overrides
 *                     `port.confirm`; only a yes runs it;
 *   - PREFETCH      → the run's VOLATILE tail (returned to `runPreamble`, which rides it
 *                     after the history beside the host's task context — never the
 *                     system prompt);
 *   - LLM           → nothing here; memory and the model proceed as before.
 *
 * Every decision is a `prefetch.decision` trace step. An ANSWER is recorded as an avoided
 * call (`req.recordAvoidedCall` → the device usage ledger's `deterministic` saving). The
 * outcome reaches `port.record` on the chat's NEXT request — accepted unless it re-asks —
 * and the run's outcome record (`req.recordRunOutcome`, `gateAccepted`), which the
 * pipeline route report's gate column reads as accuracy.
 */

import {
  isReask, prefetchConfirmRequest, runGate,
  type GateOutcome, type GateRunResult, type PrefetchAction, type PrefetchPort,
} from '@builderforce/prefetch';
import { MEDIAN_TURN_TOKENS } from '@builderforce/spend-contract';
import type { RunCell } from './runCell';
import { nowIso, pushTrace } from './runCells';
import { latestUserText } from './convoText';
import { adoptAnswerWithoutModel } from './adoptAnswer';
import { requestRunConfirm, resolveRunConfirm } from './runControl';
import type { BrainRunRequest } from './runTypes';

/** What the gate hands the preamble: the run is over, or the prefetched context for its tail. */
export interface GateRun {
  answered: boolean;
  /** PREFETCH output for the volatile per-turn block, in decision order. */
  tail: string[];
}

/** An outcome waiting for the chat's next request to say whether it was accepted. */
export interface PendingGateOutcome {
  request: string;
  outcome: Omit<GateOutcome, 'accepted'>;
  /** The run the decision was made in — where its accuracy is recorded. */
  runId?: string;
}

const NOTHING: GateRun = { answered: false, tail: [] };

/**
 * A best-effort host write (calibration, the outcome reading, the avoided-call row) that
 * failed: recorded on the run's own trace (persisted with the run) instead of swallowed —
 * the same rule as `runEndOutcome.ts`. Never fails the run.
 */
function unrecorded(c: RunCell, what: string, e: unknown): void {
  pushTrace(c, { ts: nowIso(), category: 'message', label: 'prefetch.unrecorded', args: { what }, result: e instanceof Error ? e.message : String(e) });
}

/** Run a host write that may throw or reject; a failure is {@link unrecorded}. */
function bestEffort(c: RunCell, what: string, write: () => unknown): void {
  let pending: unknown;
  try {
    pending = write();
  } catch (e) {
    unrecorded(c, what, e);
    return;
  }
  void Promise.resolve(pending).then(undefined, (e: unknown) => unrecorded(c, what, e));
}

/** The previous decision's outcome, settled by this request: a re-ask is a rejection. */
function settlePending(c: RunCell, port: PrefetchPort, req: BrainRunRequest, request: string): void {
  const pending = c.pendingGate;
  c.pendingGate = null;
  if (!pending) return;
  const accepted = !isReask(pending.request, request);
  const { runId } = pending;
  if (port.record) bestEffort(c, 'calibration', () => port.record!({ ...pending.outcome, accepted }));
  if (runId && req.recordRunOutcome) bestEffort(c, 'gate-outcome', () => req.recordRunOutcome!({ runId, gateAccepted: accepted }));
}

/**
 * The confirm a write action waits on: the host's override, else the run's own channel —
 * the pending confirm every surface renders (as the PreFetch chip), answered by
 * `resolveRunConfirm`. Stop declines it there; any other abort of the run declines it here.
 */
function confirmVia(port: PrefetchPort, runKey: number, stop: AbortSignal | undefined) {
  return async (action: PrefetchAction, request: string, detail?: string): Promise<boolean> => {
    if (port.confirm) return port.confirm(action, request, detail);
    if (stop?.aborted) return false;
    const onAbort = (): void => resolveRunConfirm(runKey, false);
    stop?.addEventListener('abort', onAbort, { once: true });
    try {
      return await requestRunConfirm(runKey, prefetchConfirmRequest(action, request, detail));
    } finally {
      stop?.removeEventListener('abort', onAbort);
    }
  };
}

function decisionTrace(c: RunCell, pass: GateRunResult): void {
  const { decision } = pass;
  pushTrace(c, {
    ts: nowIso(),
    category: 'message',
    label: 'prefetch.decision',
    durationMs: pass.elapsedMs,
    args: {
      route: decision.route,
      actions: decision.actions.map(({ id, p, tier }) => ({ id, p, tier })),
      pNeedsLlm: decision.pNeedsLlm,
      tiers: decision.tiersRun,
    },
    result: {
      settled: pass.settled,
      classifyMs: decision.elapsedMs,
      elapsedMs: pass.elapsedMs,
      ran: pass.ran.map(({ action, result, confirmed }) => ({
        id: action.id,
        ok: !!result,
        ...(confirmed !== undefined ? { confirmed } : {}),
        ...(result?.data ? { data: result.data } : {}),
      })),
    },
  });
}

/** The model an avoided call would have run on — what its saving is priced at. */
function routedModel(c: RunCell, req: BrainRunRequest): string | undefined {
  return req.model || c.lastServedModel || undefined;
}

export async function answerDeterministically(chatId: number, c: RunCell, req: BrainRunRequest, runId?: string, runKey: number = chatId): Promise<GateRun> {
  const port = req.prefetch;
  if (!port || c.abort?.signal.aborted) return NOTHING;
  const query = latestUserText(c.transcript);
  if (!query) return NOTHING;
  settlePending(c, port, req, query);
  const stop = c.abort?.signal;
  const pass = await runGate(query, port, {
    ...(stop ? { signal: stop } : {}),
    confirm: confirmVia(port, runKey, stop),
    adopt: ({ action, candidate, result }) => adoptAnswerWithoutModel(chatId, c, req, result.text, {
      label: action.id,
      args: { query },
      result: {
        source: action.id,
        p: candidate.p,
        tier: candidate.tier,
        route: 'answer',
        ...(result.chips?.length ? { chips: result.chips } : {}),
        ...(result.data ? { data: result.data } : {}),
      },
    }),
  });
  if (!pass) return NOTHING;
  decisionTrace(c, pass);
  const lead = pass.lead;
  if (lead) {
    c.pendingGate = {
      request: query,
      outcome: { actionId: lead.action.id, route: pass.settled === 'answer' ? 'answer' : 'prefetch', p: lead.candidate.p, tier: lead.candidate.tier, features: lead.candidate.features },
      ...(runId ? { runId } : {}),
    };
  }
  if (pass.answer) {
    recordAvoided(c, req, pass.answer.action.id, runId);
    return { answered: true, tail: [] };
  }
  return { answered: false, tail: pass.tail };
}

/** The avoided model call, through the host's usage ledger. Best-effort, never awaited. */
function recordAvoided(c: RunCell, req: BrainRunRequest, actionId: string, runId: string | undefined): void {
  if (!req.recordAvoidedCall) return;
  const model = routedModel(c, req);
  const record = req.recordAvoidedCall;
  bestEffort(c, 'avoided-call', () => record({
    source: 'deterministic',
    actionId,
    ...(runId ? { runId } : {}),
    ...(model ? { model } : {}),
    promptTokens: MEDIAN_TURN_TOKENS.prompt,
    completionTokens: MEDIAN_TURN_TOKENS.completion,
  }));
}
