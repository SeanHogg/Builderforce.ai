/**
 * `same_model_roles` — the run handed off from planning to coding and the same model served both roles, so the
 * hand-off bought nothing (a `local/…` pin serves every role). Read off `routingByRole`.
 */
import { finding, turnEvidence } from '../findingParts';
import type { RunFinding, RunView } from '../types';

/** The one model that served a role, or null when none or several did. */
function soleModel(view: RunView, role: string): string | null {
  const models = view.routing.roles.find((r) => r.role === role)?.models ?? [];
  return models.length === 1 ? models[0]!.model : null;
}

export function sameModelRoles(view: RunView): RunFinding[] {
  const r = view.routing;
  if (r.handOffs + r.handOffsForced + r.coderReasks === 0) return [];
  const plan = soleModel(view, 'plan');
  if (!plan || plan !== soleModel(view, 'code')) return [];
  const firstPlan = view.turns.find((t) => t.role === 'plan');
  const firstCode = view.turns.find((t) => t.role === 'code');
  return [finding('same_model_roles', 'info', { model: plan }, [
    ...(firstPlan ? [turnEvidence(firstPlan)] : []),
    ...(firstCode ? [turnEvidence(firstCode)] : []),
  ])];
}
