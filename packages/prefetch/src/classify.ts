/**
 * The confidence gate — a cascade, cheapest tier first (docs/design/deterministic-prefetch.md):
 *
 *   1. exact: the composer's `/` action, or a rule pattern — p = 1;
 *   2. lexical similarity to each action's `examples`, scored by its logistic head;
 *   3. a warm local SLM's logprob pass — only when 1–2 are ambiguous, the port is warm
 *      and the budget remains;
 *   then the route: ANSWER when an answer action clears its answer threshold, PREFETCH
 *   when a prefetch action clears its prefetch threshold, otherwise LLM.
 *
 * `actions` lists every candidate that cleared its threshold, answer actions first, so
 * the host can try them in order and fall back to the prefetch ones when no answer
 * settles. On the LLM route it lists the closest few, for the trace only.
 *
 * Deterministic: equal p is ordered by action id; nothing but the logprob port varies.
 */

import { headOf, predict, thresholdOf } from './calibrate.js';
import { deadlineSignal, withinMs } from './deadline.js';
import { lexicalFeatures, tokenize } from './lexical.js';
import { AMBIGUOUS_FLOOR, TIER3_CANDIDATES, TIER3_MIN_MS, labelProbabilities, logprobPrompt } from './logprob.js';
import { NEEDS_LLM, offeredActions } from './registry.js';
import type { GateCandidate, GateDecision, GatePorts, GateTier, PrefetchAction } from './types.js';

export const DEFAULT_GATE_BUDGET_MS = 300;
/** Candidates the LLM route still lists, for the trace. */
const LLM_ROUTE_SHOWN = 3;

interface Scored extends GateCandidate {
  action: PrefetchAction;
}

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** `/dup` or `/dup something` — the slash as the request's first word. */
function slashHit(request: string, slash: string | undefined): boolean {
  if (!slash) return false;
  const head = request.trimStart().split(/\s/, 1)[0] ?? '';
  return head.toLowerCase() === slash.toLowerCase();
}

function exactHit(request: string, action: PrefetchAction): boolean {
  return slashHit(request, action.slash) || (action.patterns ?? []).some((re) => {
    re.lastIndex = 0;
    return re.test(request);
  });
}

function byP(a: Scored, b: Scored): number {
  return b.p - a.p || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The threshold `a` must clear for the route its kind takes. */
function thresholdFor(a: PrefetchAction, ports: GatePorts): number {
  const t = thresholdOf(ports.calibration, a.id);
  return a.kind === 'answer' ? t.answer : t.prefetch;
}

/** Tier 3 over the closest candidates; the candidates rescored in place. Undefined when it gave nothing. */
async function tier3(request: string, scored: Scored[], ports: GatePorts, remainingMs: number): Promise<number | undefined> {
  const port = ports.logprob!;
  const shortlist = scored.slice(0, TIER3_CANDIDATES);
  const labels = [...shortlist.map((s) => s.id), NEEDS_LLM];
  const { signal, dispose } = deadlineSignal(remainingMs, ports.signal);
  try {
    const logprobs = await withinMs(port.logprobs(logprobPrompt(request, shortlist.map((s) => s.action)), labels, signal), remainingMs, {});
    const probs = labelProbabilities(logprobs, labels);
    if (Object.keys(probs).length === 0) return undefined;
    for (const s of shortlist) {
      s.p = probs[s.id] ?? 0;
      s.tier = 3;
    }
    return probs[NEEDS_LLM] ?? 0;
  } finally {
    dispose();
  }
}

export async function classify(request: string, registry: readonly PrefetchAction[], ports: GatePorts): Promise<GateDecision> {
  const started = clock();
  const tiersRun: GateTier[] = [];
  const done = (route: GateDecision['route'], actions: Scored[], pNeedsLlm: number): GateDecision => ({
    route,
    actions: actions.map(({ id, p, tier, features }) => ({ id, p, tier, features })),
    pNeedsLlm,
    tiersRun,
    elapsedMs: Math.max(0, clock() - started),
  });
  const offered = offeredActions(registry, ports);
  if (!request.trim() || offered.length === 0 || ports.signal?.aborted) return done('llm', [], 1);

  // Tiers 1 and 2 in one pass: every offered action gets its lexical features (an outcome
  // trains the head on them whichever tier decided), and an exact hit is p = 1.
  const words = tokenize(request);
  let exact = false;
  const scored: Scored[] = offered.map((action) => {
    const features = lexicalFeatures(words, action.examples.map(tokenize));
    if (exactHit(request, action)) {
      exact = true;
      return { id: action.id, action, p: 1, tier: 1, features };
    }
    return { id: action.id, action, p: predict(headOf(ports.calibration, action.id), features), tier: 2, features };
  });
  tiersRun.push(1);
  if (!exact) tiersRun.push(2);
  scored.sort(byP);

  const top = scored[0]!;
  let pNeedsLlm = 1 - top.p;
  const budget = ports.budgetMs ?? DEFAULT_GATE_BUDGET_MS;
  const remaining = budget - (clock() - started);
  const ambiguous = !exact && top.p >= AMBIGUOUS_FLOOR && top.p < thresholdFor(top.action, ports);
  if (ambiguous && ports.logprob?.warm() && remaining >= TIER3_MIN_MS && !ports.signal?.aborted) {
    tiersRun.push(3);
    const needs = await tier3(request, scored, ports, remaining).catch(() => undefined);
    if (needs !== undefined) {
      pNeedsLlm = needs;
      scored.sort(byP);
    }
  }

  const clears = (s: Scored) => s.p >= thresholdFor(s.action, ports) && s.p > (s.tier === 3 ? pNeedsLlm : 0);
  const answers = scored.filter((s) => s.action.kind === 'answer' && clears(s));
  const prefetches = scored.filter((s) => s.action.kind === 'prefetch' && clears(s));
  if (answers.length > 0) return done('answer', [...answers, ...prefetches], pNeedsLlm);
  if (prefetches.length > 0) return done('prefetch', prefetches, pNeedsLlm);
  return done('llm', scored.slice(0, LLM_ROUTE_SHOWN), pNeedsLlm);
}
