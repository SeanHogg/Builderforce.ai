/**
 * `compile('process-chart')` — lowers a hand-drawn workflow graph into the spec's
 * ordered `steps`, reusing the existing {@link compileDefinition} (the same compiler
 * the workflow builder dispatches through). The need becomes an agent that runs the
 * steps; its allowed surface is the workflow node.
 *
 * ── NESTED CANVASES ──────────────────────────────────────────────────────────
 * A chart may hold a `subflow` step: another canvas, run as one step. That child is
 * resolved HERE, through the injected tenant-scoped loader, exactly as starting a
 * run resolves it (`application/workflow/expandSubflows.ts` — one expander, both
 * doors). Without the loader the chart is REFUSED rather than lowered: a
 * `node:subflow` step reaching the executor is a step that stands for a whole canvas
 * nobody ran, and the point of refusing an underspecified step at compile time is
 * that it does not fail at 3am instead.
 */
import type { AgentSpec } from '@builderforce/agent-tools';
import { compileDefinition } from '../../domain/workflowGraph';
import { expandSubflows } from '../workflow/expandSubflows';
import type { CompileDeps, ProcessChartNeed } from './types';

export async function compileFromGraph(need: ProcessChartNeed, deps: CompileDeps = {}): Promise<AgentSpec> {
  const nests = need.definition.nodes.some((node) => node.kind === 'subflow');
  if (nests && !deps.loadWorkflowDefinition) {
    throw new Error('This chart runs another canvas as a step, which cannot be resolved here.');
  }

  const definition = nests
    ? await (async () => {
      const expanded = await expandSubflows(need.definition, deps.loadWorkflowDefinition!);
      if (!expanded.ok) throw new Error(expanded.error);
      return expanded.definition;
    })()
    : need.definition;

  return {
    identity: { name: '' }, // identity comes from the agent the chart is embedded in
    steps: compileDefinition(definition),
    surfaces: ['workflow-node', 'cloud-durable'],
  };
}
