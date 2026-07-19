/**
 * The `compile()` primitive (compile primitive Phase C2, see
 * `PRD-agent-compile-primitive.md`).
 *
 *   compile(need, deps) → AgentSpec
 *
 * A registry of modality compilers, one per `Need` shape, each lowering its own kind
 * of need into the *same* canonical {@link AgentSpec}. Pass one need or several:
 * several are each compiled then folded with {@link mergeSpecs}, so a process chart
 * *with* a persona *with* a policy is one agent, not three. This is the only place in
 * the platform that has to know prose from charts from datasets — everything
 * downstream (`lowerAgentSpec`, `deploy()`) speaks only `AgentSpec`.
 */
import type { AgentSpec } from '@builderforce/agent-tools';
import { compileFromDataset } from './compileFromDataset';
import { compileFromDiagnostic } from './compileFromDiagnostic';
import { compileFromGraph } from './compileFromGraph';
import { compileFromPersona } from './compileFromPersona';
import { compileFromPolicy } from './compileFromPolicy';
import { compileFromProse } from './compileFromProse';
import { mergeSpecs } from './mergeSpecs';
import type { CompileDeps, Modality, Need } from './types';

/** The modality registry: each entry lowers one `Need` shape into an `AgentSpec`. */
const REGISTRY: { [M in Modality]: (need: Extract<Need, { modality: M }>, deps: CompileDeps) => AgentSpec | Promise<AgentSpec> } = {
  prose: (need, deps) => compileFromProse(need, deps),
  dataset: (need) => compileFromDataset(need),
  'process-chart': (need) => compileFromGraph(need),
  persona: (need) => compileFromPersona(need),
  diagnostic: (need, deps) => compileFromDiagnostic(need, deps),
  policy: (need) => compileFromPolicy(need),
};

/** The modalities `compile()` can lower — for the route to validate against. */
export const MODALITIES: readonly Modality[] = Object.keys(REGISTRY) as Modality[];

/** Lower a single need through its modality compiler. */
function compileOne(need: Need, deps: CompileDeps): AgentSpec | Promise<AgentSpec> {
  const adapter = REGISTRY[need.modality] as (n: Need, d: CompileDeps) => AgentSpec | Promise<AgentSpec>;
  return adapter(need, deps);
}

/**
 * Compile one or more needs into a single canonical {@link AgentSpec}. Multiple
 * needs are each lowered then merged (later needs win for scalar identity/model;
 * directives, memory, steps, surfaces, and policy gates accumulate).
 */
export async function compile(need: Need | Need[], deps: CompileDeps = {}): Promise<AgentSpec> {
  const needs = Array.isArray(need) ? need : [need];
  if (needs.length === 0) throw new Error('compile() requires at least one need');
  const specs = await Promise.all(needs.map((n) => compileOne(n, deps)));
  return mergeSpecs(specs);
}

export { mergeSpecs };
export type { CompileDeps, KnowledgeRecallHit, LlmComplete, Modality, Need, RecallKnowledge } from './types';
