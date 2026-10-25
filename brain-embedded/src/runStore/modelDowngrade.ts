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
 *    the header rides every turn, the fact does not change.
 *
 * Pure.
 */

import type { BrainTraceEvent } from '../brainTriage';

export const MODEL_DOWNGRADE_LABEL = 'llm.model_downgrade';

export interface ModelDowngradeInput {
  requested: string;
  resolved: string;
  /** This turn's `x-builderforce-byo-unresolved` value, when it carried one. */
  byoUnresolved?: string;
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
  if (!unresolved) return null;
  const said = input.events.some((e) => {
    if (e.label !== MODEL_DOWNGRADE_LABEL) return false;
    const args = e.args as { requestedModel?: unknown; model?: unknown } | undefined;
    return args?.requestedModel === 'default' && args.model === resolved;
  });
  if (said) return null;
  return {
    ts,
    category: 'message',
    label: MODEL_DOWNGRADE_LABEL,
    args: { requestedModel: 'default', model: resolved, step, byoUnresolved: unresolved },
    result: `Auto-routing answered with ${resolved} because a connected account could not be used (${unresolved}) — the run is not on the tenant's own model. Reconnect it under Settings ▸ API Keys.`,
  };
}
