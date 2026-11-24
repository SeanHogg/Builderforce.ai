import type { PolicyHooks } from '../policy/index.js';
import type { RunAgentInput } from '../runContext.js';
import { measureWorkflow, workflowScope } from './workflowMetrics.js';

/** Observe the authoritative finish verdicts without re-running a gate or interpreting its prose. */
export function workflowHooks(hooks: PolicyHooks, input: RunAgentInput): PolicyHooks {
  const finish = hooks.finish;
  return { ...hooks, finish: {
    ...finish,
    gate: (ctx) => measureWorkflow(input.ports.events, workflowScope(input, ctx.step), 'finish', () => finish.gate(ctx), (block) => block ? 'blocked' : 'completed'),
    ...(finish.openWork ? { openWork: (ctx: Parameters<NonNullable<typeof finish.openWork>>[0]) =>
      measureWorkflow(input.ports.events, workflowScope(input, ctx.step), 'ledger', () => finish.openWork!(ctx), (block) => block ? 'blocked' : 'completed') } : {}),
    ...(finish.liveChildren ? { liveChildren: (ctx: Parameters<NonNullable<typeof finish.liveChildren>>[0]) =>
      measureWorkflow(input.ports.events, workflowScope(input, ctx.step), 'finish', () => finish.liveChildren!(ctx), (block) => block ? 'blocked' : 'completed') } : {}),
  } };
}
