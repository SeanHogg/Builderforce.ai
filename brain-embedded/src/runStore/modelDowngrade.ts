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
 *    ({@link planModelWarning}); an unpriced model is unknown, not weak. Once per served model.
 *
 * Pure.
 */

import type { PriceBook } from '@builderforce/model-catalog';
import type { BrainTraceEvent } from '../brainTriage';
import { planModelWarning } from './modelPreflight';

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
  if (resolved === 'default') return null;
  if (requested !== 'default') {
    if (resolved === requested) return null;
    return {
      ts,
      category: 'message',
      label: MODEL_DOWNGRADE_LABEL,
      args: { requestedModel: requested, model: resolved, step },
      result: `Gateway answered with ${resolved} instead of the requested ${requested} (failover) — a smaller context window can truncate long transcripts.`,
    };
  }
  const unresolved = (input.byoUnresolved ?? '').trim();
  const flash = !unresolved && input.planPhase ? planModelWarning(resolved, input.book) : null;
  if (!unresolved && !flash) return null;
  const said = input.events.some((e) => {
    if (e.label !== MODEL_DOWNGRADE_LABEL) return false;
    const args = e.args as { requestedModel?: unknown; model?: unknown } | undefined;
    return args?.requestedModel === 'default' && args.model === resolved;
  });
  if (said) return null;
  if (flash) {
    return {
      ts,
      category: 'message',
      label: MODEL_DOWNGRADE_LABEL,
      args: { requestedModel: 'default', model: resolved, step, planTier: flash.tier },
      result: `Auto-routing planned this run on ${resolved}, a ${flash.tier}-tier (Flash-class) model — weak at planning a multi-step change; pick a stronger model for planning if the result matters.`,
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
