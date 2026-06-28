/**
 * `compile('policy')` — lowers governance gates onto the spec's `policy` slot. Once
 * on the spec, the gates ride every surface the agent deploys to via the shared
 * lowering (and `evaluatePolicyGate` at the engine's tool seam), so a rule authored
 * once applies in the IDE exactly as on a cloud tick. Pure.
 */
import type { AgentSpec } from '@builderforce/agent-tools';
import type { PolicyNeed } from './types';

export function compileFromPolicy(need: PolicyNeed): AgentSpec {
  const gates = (need.gates ?? []).filter((g) => g && g.id && g.effect);
  return {
    identity: { name: '' }, // policy carries no identity; merged onto another spec
    ...(gates.length ? { policy: { gates } } : {}),
  };
}
