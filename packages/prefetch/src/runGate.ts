/**
 * ONE gate pass over a request (docs/design/deterministic-prefetch.md, "Sequence") — the
 * part every run preamble shares, whatever holds the run:
 *
 *   - classify the request against the port's registry;
 *   - ANSWER: the cleared answer actions, best first — a write action only after the
 *     host's confirm says yes — under each one's budget and the run's Stop; the first
 *     result the host ADOPTS settles the turn. A result whose own `confidence` is below
 *     the action's learned answer threshold is not offered for adoption: it rides the
 *     tail as PREFETCH context (`knowledge.ask`: the index's hits, short of an answer);
 *   - PREFETCH: the cleared prefetch actions in parallel, their output for the run's
 *     volatile per-turn block;
 *   - LLM: nothing ran.
 *
 * The host supplies only what is its own: how it asks the person (`confirm`) and how it
 * settles a turn without a model (`adopt`). brain-embedded's `prefetchGate.ts` (the
 * editor and web runs) and agent-runtime's on-prem preamble both drive this, so the
 * ANSWER/PREFETCH rules live once. Pure: tools run only through `port.executors`.
 */

import { thresholdOf } from './calibrate.js';
import { classify } from './classify.js';
import { deadlineSignal, withinMs } from './deadline.js';
import type { GateCandidate, GateDecision, GateRoute, PrefetchAction, PrefetchPort, PrefetchResult } from './types.js';

/** The longest the gate waits for `port.prepare` (the first tool detection in a workspace). */
export const PREPARE_BUDGET_MS = 1_500;

/** One action the pass ran (or was declined), with what it returned. */
export interface GateRanAction {
  candidate: GateCandidate;
  action: PrefetchAction;
  result: PrefetchResult | undefined;
  /** Write actions only: whether the person confirmed it. */
  confirmed?: boolean;
}

export interface GateRunHooks {
  /** The run's Stop. */
  signal?: AbortSignal;
  /** Ask the person before a WRITE action runs. Absent ⇒ declined: a write never auto-runs. */
  /** `detail`: the executor's {@link previewPrefetchAction} line, for the confirm chip. */
  confirm?(action: PrefetchAction, request: string, detail?: string): Promise<boolean>;
  /** Settle the turn on an ANSWER's result; false when nothing was adopted (the next answer is tried). */
  adopt(ran: GateRanAction & { result: PrefetchResult }): Promise<boolean>;
}

export interface GateRunResult {
  decision: GateDecision;
  /** What the turn became: answered, facts gathered, or left to the model. */
  settled: GateRoute;
  ran: GateRanAction[];
  /** The ANSWER that settled the turn. */
  answer?: GateRanAction & { result: PrefetchResult };
  /** PREFETCH output for the volatile per-turn block, in decision order. */
  tail: string[];
  /** The action whose outcome trains its head: the answer, else the first prefetch that returned. */
  lead?: GateRanAction;
  elapsedMs: number;
}

/** The longest a write action's `preview` (the confirm chip's numbers) may take. */
export const PREVIEW_BUDGET_MS = 30_000;

/** A write action's confirm-chip detail (`PrefetchExecutor.preview`); undefined when it has none, is late or fails. */
export async function previewPrefetchAction(port: PrefetchPort, action: PrefetchAction, request: string, stop: AbortSignal | undefined): Promise<string | undefined> {
  const preview = port.executors[action.id]?.preview;
  if (!preview) return undefined;
  const ms = Math.min(action.budgetMs, PREVIEW_BUDGET_MS);
  const { signal, dispose } = deadlineSignal(ms, stop);
  try {
    const detail = await withinMs(preview.call(port.executors[action.id], request, signal), ms, undefined);
    return detail?.trim() || undefined;
  } finally {
    dispose();
  }
}

/** One executor under its budget and the run's Stop; undefined when late, empty or failed. */
export async function runPrefetchAction(port: PrefetchPort, action: PrefetchAction, request: string, stop: AbortSignal | undefined): Promise<PrefetchResult | undefined> {
  const executor = port.executors[action.id];
  if (!executor) return undefined;
  const { signal, dispose } = deadlineSignal(action.budgetMs, stop);
  try {
    const result = await withinMs(executor.run(request, signal), action.budgetMs, undefined);
    return result?.text?.trim() ? result : undefined;
  } finally {
    dispose();
  }
}

/**
 * An ANSWER whose executor reported its own evidence (`confidence`) below the action's
 * learned answer threshold: the gate keeps it as context, never as the turn's answer.
 */
export function belowAnswerThreshold(port: PrefetchPort, action: PrefetchAction, result: PrefetchResult): boolean {
  if (result.confidence === undefined) return false;
  return !(result.confidence >= thresholdOf(port.ports.calibration, action.id).answer);
}

/** The gate pass. Null when the classifier itself failed — the run then proceeds as if no gate existed. */
export async function runGate(request: string, port: PrefetchPort, hooks: GateRunHooks): Promise<GateRunResult | null> {
  const started = Date.now();
  const stop = hooks.signal;
  if (port.prepare) await withinMs(port.prepare(stop).catch(() => undefined), PREPARE_BUDGET_MS, undefined);
  let decision: GateDecision;
  try {
    decision = await classify(request, port.registry, { ...port.ports, ...(stop ? { signal: stop } : {}) });
  } catch {
    return null;
  }
  const byId = new Map(port.registry.map((a) => [a.id, a] as const));
  const chosen = decision.route === 'llm'
    ? []
    : decision.actions.flatMap((candidate) => {
      const action = byId.get(candidate.id);
      return action ? [{ candidate, action }] : [];
    });
  const ran: GateRanAction[] = [];
  /** Answers whose own evidence fell short: they ride the tail as PREFETCH context. */
  const demoted: Array<{ entry: GateRanAction; text: string }> = [];
  const done =(settled: GateRoute, extra: Partial<GateRunResult> = {}): GateRunResult =>
    ({ decision, settled, ran, tail: [], elapsedMs: Date.now() - started, ...extra });

  // ANSWER: the cleared answer actions, best first; the first the host adopts ends the turn.
  for (const { candidate, action } of chosen.filter((x) => x.action.kind === 'answer')) {
    if (stop?.aborted || !port.executors[action.id]) continue;
    let confirmed: boolean | undefined;
    if (action.sideEffect === 'write') {
      const detail = hooks.confirm ? await previewPrefetchAction(port, action, request, stop) : undefined;
      confirmed = hooks.confirm ? await hooks.confirm(action, request, detail).catch(() => false) : false;
      if (!confirmed || stop?.aborted) {
        ran.push({ candidate, action, result: undefined, confirmed: false });
        continue;
      }
    }
    const result = await runPrefetchAction(port, action, request, stop);
    const entry: GateRanAction = { candidate, action, result, ...(confirmed !== undefined ? { confirmed } : {}) };
    ran.push(entry);
    if (!result) continue;
    if (belowAnswerThreshold(port, action, result)) {
      demoted.push({ entry, text: (result.context ?? result.text).trim() });
      continue;
    }
    const answer = { ...entry, result };
    if (await hooks.adopt(answer)) return done('answer', { answer, lead: answer });
  }

  // PREFETCH: the cleared prefetch actions, in parallel, into the volatile tail — after
  // any answer the gate demoted (its evidence was below the action's learned threshold).
  const prefetches = chosen.filter((x) => x.action.kind === 'prefetch' && port.executors[x.action.id]);
  const results = await Promise.all(prefetches.map(({ action }) => runPrefetchAction(port, action, request, stop)));
  const tail: string[] = [];
  let lead: GateRanAction | undefined;
  for (const { entry, text } of demoted) {
    if (!text) continue;
    tail.push(text);
    lead ??= entry;
  }
  prefetches.forEach(({ candidate, action }, i) => {
    const entry: GateRanAction = { candidate, action, result: results[i] };
    ran.push(entry);
    if (!results[i]) return;
    tail.push(results[i]!.text);
    lead ??= entry;
  });
  return done(tail.length > 0 ? 'prefetch' : 'llm', { tail, ...(lead ? { lead } : {}) });
}
