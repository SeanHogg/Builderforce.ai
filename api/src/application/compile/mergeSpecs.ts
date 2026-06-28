/**
 * Merge several partial {@link AgentSpec}s (one per stacked modality) into one.
 *
 * This is what makes "a process chart *with* a persona *with* a trained model" a
 * single agent rather than three: each adapter emits the slice of the spec it knows
 * about, and `mergeSpecs` folds them left-to-right into one canonical spec. Pure and
 * deterministic — later specs win for scalar identity/model fields; list-valued
 * fields (persona directives, memory, steps, surfaces, policy gates) accumulate.
 */
import type { AgentSpec, AgentSurface } from '@builderforce/agent-tools';

function firstDefined<T>(...vals: (T | undefined)[]): T | undefined {
  return vals.find((v) => v !== undefined);
}

export function mergeSpecs(specs: AgentSpec[]): AgentSpec {
  if (specs.length === 1) return specs[0]!;

  const identity: AgentSpec['identity'] = { name: '' };
  let model: AgentSpec['model'];
  const directives: string[] = [];
  let execParams: NonNullable<AgentSpec['persona']>['execParams'];
  const recalled: string[] = [];
  let stateSignal: NonNullable<AgentSpec['memory']>['stateSignal'];
  const steps: unknown[] = [];
  const surfaces = new Set<AgentSurface>();
  const gates: NonNullable<AgentSpec['policy']>['gates'] = [];
  let id: string | undefined;

  for (const s of specs) {
    id = firstDefined(s.id, id);
    if (s.identity?.name) identity.name = s.identity.name;
    identity.title = firstDefined(s.identity?.title, identity.title);
    identity.bio = firstDefined(s.identity?.bio, identity.bio);
    if (s.identity?.skills) identity.skills = s.identity.skills;
    if (s.model?.ref || s.model?.autoRoute !== undefined) model = { ...model, ...s.model };
    if (s.persona?.directives) directives.push(...s.persona.directives);
    if (s.persona?.execParams) execParams = { ...execParams, ...s.persona.execParams };
    if (s.memory?.recalledContext) recalled.push(s.memory.recalledContext);
    if (s.memory?.stateSignal) stateSignal = s.memory.stateSignal;
    if (s.steps) steps.push(...s.steps);
    for (const surf of s.surfaces ?? []) surfaces.add(surf);
    if (s.policy?.gates) gates.push(...s.policy.gates);
  }

  return {
    ...(id ? { id } : {}),
    identity,
    ...(model ? { model } : {}),
    ...(directives.length || execParams ? { persona: { ...(directives.length ? { directives } : {}), ...(execParams ? { execParams } : {}) } } : {}),
    ...(recalled.length || stateSignal ? { memory: { ...(recalled.length ? { recalledContext: recalled.join('\n\n') } : {}), ...(stateSignal ? { stateSignal } : {}) } } : {}),
    ...(gates.length ? { policy: { gates } } : {}),
    ...(steps.length ? { steps } : {}),
    ...(surfaces.size ? { surfaces: [...surfaces] } : {}),
  };
}
