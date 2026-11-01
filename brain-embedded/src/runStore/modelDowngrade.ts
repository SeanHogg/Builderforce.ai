/**
 * `llm.model_downgrade` — the trace step that says a turn was answered by a model other
 * than the one the run expected (PRD 35 E7).
 *
 * Two cases, one event:
 *  - a PINNED model (`requested !== 'default'`) answered by another — a gateway failover,
 *    every turn it happens (the original rule);
 *  - an AUTO-ROUTED turn (`requested === 'default'`) that carried a BYO-unresolved signal:
 *    the tenant's own account could not be used, so routing landed elsewhere. On the
 *    2026-10-25 run that was an expired Anthropic token and a whole planning phase on a
 *    Flash-class model, with no trace at all. Recorded once per served model per run —
 *    the header rides every turn, the fact does not change;
 *  - an AUTO-ROUTED turn in the PLAN phase (no code changed yet) that routing landed on a
 *    Flash-class (non-agentic tier) model with no BYO signal at all — the same weak plan,
 *    for a reason the header does not carry. The tier is the preflight's own rule
 *    (`planModelWarning`); an unpriced model is unknown, not weak. Once per served model.
 *
 * Pure. The Brain's TRACE form of the agent's own rule: WHICH of the three cases a turn is, is the agent's one decision
 * (`downgradeDecision`, `policy/model/downgradeRule.ts`); this home supplies its inputs (each turn's gateway header as the BYO signal, THIS run's
 * trace as "said already") and the wording. The agent's event for it is not written on the Brain (`run/runPrepared.ts` `recorded`).
 */

import type { PriceBook } from '@builderforce/model-catalog';
import type { BrainTraceEvent } from '../brainTriage';
import { downgradeDecision } from '@builderforce/agent-run';

export const MODEL_DOWNGRADE_LABEL = 'llm.model_downgrade';

export interface ModelDowngradeInput {
  requested: string;
  resolved: string;
  /** This turn's `x-builderforce-byo-unresolved` value, when it carried one. */
  byoUnresolved?: string;
  /** True while the run has changed no code — the turns that plan the change. */
  planPhase?: boolean;
  /** The price book the tier is read from — the release's bundled one when absent. */
  book?: PriceBook;
  step: number;
  ts: string;
  /** THIS run's trace so far — an auto-routed downgrade is said once per served model. */
  events: readonly BrainTraceEvent[];
}

export function modelDowngradeEvent(input: ModelDowngradeInput): BrainTraceEvent | null {
  const { requested, resolved, step, ts } = input;
  const unresolved = (input.byoUnresolved ?? '').trim();
  const decision = downgradeDecision({
    // The Brain's `requested` is the gateway's `default` when it asked for nothing.
    asked: requested !== 'default' ? requested : undefined,
    served: resolved,
    byo: unresolved,
    planPhase: input.planPhase === true,
    seen: input.events.some((e) => {
      if (e.label !== MODEL_DOWNGRADE_LABEL) return false;
      const args = e.args as { requestedModel?: unknown; model?: unknown } | undefined;
      return args?.requestedModel === 'default' && args.model === resolved;
    }),
    ...(input.book ? { book: input.book } : {}),
  });
  if (!decision) return null;
  if (decision.kind === 'failover') {
    return {
      ts,
      category: 'message',
      label: MODEL_DOWNGRADE_LABEL,
      args: { requestedModel: requested, model: resolved, step },
      result: `Gateway answered with ${resolved} instead of the requested ${requested} (failover) — a smaller context window can truncate long transcripts.`,
    };
  }
  if (decision.kind === 'plan_tier') {
    return {
      ts,
      category: 'message',
      label: MODEL_DOWNGRADE_LABEL,
      args: { requestedModel: 'default', model: resolved, step, planTier: decision.tier },
      result: `Auto-routing planned this run on ${resolved}, a ${decision.tier}-tier (Flash-class) model — weak at planning a multi-step change; pick a stronger model for planning if the result matters.`,
    };
  }
  return {
    ts,
    category: 'message',
    label: MODEL_DOWNGRADE_LABEL,
    args: { requestedModel: 'default', model: resolved, step, byoUnresolved: unresolved },
    result: `Auto-routing answered with ${resolved} because a connected account could not be used (${unresolved}) — the run is not on the tenant's own model. Reconnect it under Settings ▸ API Keys.`,
  };
}
