/**
 * `compile('process-chart')` — lowers a hand-drawn workflow graph into the spec's
 * ordered `steps`, reusing the existing {@link compileDefinition} (the same compiler
 * the workflow builder dispatches through). The need becomes an agent that runs the
 * steps; its allowed surface is the workflow node. Pure.
 */
import type { AgentSpec } from '@builderforce/agent-tools';
import { compileDefinition } from '../../domain/workflowGraph';
import type { ProcessChartNeed } from './types';

export function compileFromGraph(need: ProcessChartNeed): AgentSpec {
  const steps = compileDefinition(need.definition);
  return {
    identity: { name: '' }, // identity comes from the agent the chart is embedded in
    steps,
    surfaces: ['workflow-node', 'cloud-durable'],
  };
}
