/**
 * runViaAgent — one Brain run, driven by THE one agent (PRD 35 §3.1).
 *
 * The call a surface's run entry makes: it builds the run's ports and policy from the
 * binding (`./webAdapter.ts`) and hands them to `runAgent`. There is no loop here and no
 * policy — the agent owns both; this only joins the Brain's cell to it (the cell's Stop is
 * the run's signal).
 */

import { runAgent, type RunOutcome } from '@builderforce/agent-run';
import { brainRunPolicy, brainRunTask, buildBrainRunPorts, type BrainRunBinding } from './webAdapter';

/** Drive the run described by `binding` to its outcome. */
export function runViaAgent(binding: BrainRunBinding, opts: { defaultRepo?: string } = {}): Promise<RunOutcome> {
  const signal = binding.cell.abort?.signal;
  return runAgent({
    task: brainRunTask(binding, opts.defaultRepo),
    policy: brainRunPolicy(binding),
    ports: buildBrainRunPorts(binding),
    ...(signal ? { signal } : {}),
  });
}
