/**
 * One PREPARED Brain run (`runStore/runPreamble.ts`), driven by THE one agent (PRD 35 §4 WS4). The preamble assembled what
 * the canvas assembles for itself - the system prompt, the transcript, the catalog, the recall - and this hands it over as
 * the task's transcript, the policy data and the ports. There is no loop here and no policy: the agent owns both, and an
 * adapter only builds ports (`webAdapter.ts`, `loopTurn.ts`, `brainPlatformTools.ts`, `loopSteering.ts`, `loopStore.ts`).
 */

import { runAgent } from '@builderforce/agent-run';
import type { RunLoopContext } from '../runStore/runLoopContext';
import { brainDeliveryLedger } from './brainDelivery';
import { brainPlatformTools } from './brainPlatformTools';
import { loopRunStore } from './loopStore';
import { loopSteeringSource } from './loopSteering';
import { settleBrainRun } from './loopSettle';
import { loopTurnObserver } from './loopTurn';
import { toRunMessage } from './runMessages';
import { brainRunPolicy, brainRunTask, buildBrainRunPorts, type BrainRunBinding } from './webAdapter';

/** Drive the prepared run to its outcome and settle it on the chat. */
export async function runPrepared(run: RunLoopContext): Promise<void> {
  const { c, req, runKey } = run;
  const { observer, last } = loopTurnObserver(run);
  const platform = brainPlatformTools(run);
  const binding: BrainRunBinding = {
    entryPoint: req.entryPoint ?? 'web',
    cell: c,
    runKey,
    req,
    capabilities: { capabilities: new Set() },
    request: run.userRequest,
    turn: observer,
    platform: platform.tools,
    delivery: brainDeliveryLedger(run, last),
    // A question ends the run before any call dispatches (decided once per turn in `loopTurn.ts`).
    extensions: {
      schemas: () => [],
      handles: () => false,
      dispatch: async () => ({ data: null }),
      terminalTurn: () => { const reply = last.terminal; last.terminal = undefined; return reply; },
    },
    steering: loopSteeringSource(run, () => last.step),
    store: loopRunStore(c, { toolRowAppended: platform.toolRowAppended }),
    ...(req.reportRunRow ? { reportOutcome: req.reportRunRow } : {}),
  };
  const transcript = [{ role: 'system' as const, content: run.systemPrompt }, ...run.convo.map(toRunMessage)];
  // The TASK is the person's request: compaction pins it, whatever conversation comes before it.
  const request = transcript.map((row) => row.role).lastIndexOf('user');
  if (request >= 0) transcript[request] = { ...transcript[request]!, task: true };
  const signal = c.abort?.signal;
  const outcome = await runAgent({
    task: { ...brainRunTask(binding), transcript },
    policy: brainRunPolicy(binding),
    ports: buildBrainRunPorts(binding),
    ...(signal ? { signal } : {}),
  });
  await settleBrainRun(run, outcome, last);
}
