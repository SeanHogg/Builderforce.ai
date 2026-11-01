/**
 * One PREPARED Brain run (`runStore/runPreamble.ts`), driven by THE one agent (PRD 35 §4 WS4). The preamble assembled what
 * the canvas assembles for itself - the system prompt, the transcript, the catalog, the recall - and this hands it over as
 * the task's transcript, the policy data and the ports. There is no loop here and no policy: the agent owns both, and an
 * adapter only builds ports (`webAdapter.ts`, `loopTurn.ts`, `brainPlatformTools.ts`, `loopSteering.ts`, `loopStore.ts`).
 */

import { runAgent } from '@builderforce/agent-run';
import type { RunLoopContext } from '../runStore/runLoopContext';
import { pipelinePolicyOptions } from '../runStore/pipelineRoute';
import { brainDeliveryLedger } from './brainDelivery';
import { brainPlatformTools } from './brainPlatformTools';
import { brainCompaction } from './loopFold';
import { loopRunStore } from './loopStore';
import { loopSpendMeter } from './loopSpend';
import { loopSteeringSource, personSteers } from './loopSteering';
import { settleBrainRun } from './loopSettle';
import { brainEventSink } from './eventSink';
import { discardAnswered, loopTurnObserver } from './loopTurn';
import { toRunMessage } from './runMessages';
import { withoutUncallableTurns } from './brainModelRules';
import { brainRunPolicy, brainRunTask, buildBrainRunPorts, type BrainRunBinding } from './webAdapter';

/** Drive the prepared run to its outcome and settle it on the chat. */
export async function runPrepared(run: RunLoopContext): Promise<void> {
  const { c, req, runKey } = run;
  const compaction = brainCompaction(run);
  const { observer, last, keepAnswered } = loopTurnObserver(run, compaction.savedTokens);
  const people = personSteers();
  const platform = brainPlatformTools(run);
  const spend = loopSpendMeter(run);
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
    events: brainEventSink(c, req.reportRunRow, {
      coderReask: (e) => discardAnswered(run, last, e.step, e.model),
      turnKept: keepAnswered,
      budgetStop: (e) => { last.contained = e.text; },
      // The turn recorder writes the model downgrade, and the steering port records each direction it drains.
      recorded: new Set(['llm.model_downgrade', 'steer.applied'] as const),
    }),
    // The preamble ran the host's model preflight already (`hostRunContext.ts`): once per run.
    preflighted: true,
    start: pipelinePolicyOptions(req, run.pipeline),
    // From here the model policy is the AGENT's: the Brain's guards read `run.policy` and report to it through the view.
    attach: (view) => {
      run.view = view;
      Object.defineProperty(run, 'policy', { get: () => view.policy(), configurable: true });
    },
    // A question ends the run before any call dispatches (decided once per turn in `loopTurn.ts`).
    extensions: {
      schemas: () => [],
      handles: () => false,
      dispatch: async () => ({ data: null }),
      terminalTurn: () => { const reply = last.terminal; last.terminal = undefined; return reply; },
    },
    steering: loopSteeringSource(run, people),
    ...(spend ? { spend } : {}),
    store: loopRunStore(c, { toolRowAppended: platform.toolRowAppended, personSteer: people.take }),
    ...(req.reportRunRow ? { reportOutcome: req.reportRunRow } : {}),
  };
  const transcript = [{ role: 'system' as const, content: run.systemPrompt }, ...run.convo.map(toRunMessage)];
  // The TASK is the person's request: compaction pins it, whatever conversation comes before it.
  const request = transcript.map((row) => row.role).lastIndexOf('user');
  if (request >= 0) transcript[request] = { ...transcript[request]!, task: true };
  const ports = buildBrainRunPorts(binding);
  const signal = c.abort?.signal;
  const outcome = await runAgent({
    task: { ...brainRunTask(binding), transcript },
    policy: brainRunPolicy(binding),
    ports: { ...ports, model: withoutUncallableTurns(ports.model, req) },
    // The Brain's own fold (`loopFold.ts`), not the agent's compaction adapted to imitate it.
    modules: { compaction: compaction.hook },
    ...(signal ? { signal } : {}),
  });
  await settleBrainRun(run, outcome, last);
}
