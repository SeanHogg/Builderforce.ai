/**
 * One PREPARED Brain run (`runStore/runPreamble.ts`), driven by THE one agent (PRD 35 §4 WS4). The preamble assembled what
 * the canvas assembles for itself - the system prompt, the transcript, the catalog, the recall - and this hands it over as
 * the task's transcript, the policy data and the ports. There is no loop here and no policy: the agent owns both, and an
 * adapter only builds ports (`webAdapter.ts`, `brainTurn.ts`, `brainPlatformTools.ts`, `brainSteering.ts`, `brainStore.ts`).
 */

import { openRun } from '@builderforce/agent-run';
import type { BrainRunContext } from '../runStore/brainRunContext';
import { brainDeliveryLedger } from './brainDelivery';
import { brainPlatformTools } from './brainPlatformTools';
import { brainCompaction } from './brainFold';
import { brainGuardPorts } from './brainProgressPorts';
import { brainFinishPorts } from './brainFinish';
import { recordedPreflight } from './preflightRecorded';
import { brainRunStorePort } from './brainStore';
import { brainSpendMeter } from './brainSpend';
import { brainSteeringSource, personSteers } from './brainSteering';
import { settleBrainRun } from './brainSettle';
import { brainEventSink } from './eventSink';
import { closeOutPort } from '../runStore/deterministicFinish';
import { openLinkedWorkHold } from '../runStore/openLinkedWorkHold';
import { specTicketCoverageGate } from '../runStore/specTicketCoverageGate';
import { discardAnswered, brainTurnObserver } from './brainTurn';
import { toRunMessage } from './runMessages';
import { withoutUncallableTurns } from './brainModelRules';
import { brainRunPolicy, brainRunTask, buildBrainRunPorts, type BrainRunBinding } from './webAdapter';
import { decidedRoute } from '../runStore/runRoute';

/** Drive the prepared run to its outcome and settle it on the chat. */
export async function runPrepared(run: BrainRunContext): Promise<void> {
  const { c, req } = run;
  const compaction = brainCompaction(run);
  const { observer, last, keepAnswered } = brainTurnObserver(run, compaction.savedTokens);
  const people = personSteers();
  const platform = brainPlatformTools(run);
  const spend = brainSpendMeter(run);
  const binding: BrainRunBinding = {
    entryPoint: req.entryPoint,
    req,
    capabilities: { capabilities: new Set() },
    request: run.userRequest,
    turn: observer,
    platform: platform.tools,
    delivery: brainDeliveryLedger(run, last),
    events: brainEventSink(c, run.reportRunRow, {
      coderReask: (e) => discardAnswered(run, last, e.step, e.model),
      turnKept: keepAnswered,
      budgetStop: (e) => { last.contained = e.text; },
      // The turn recorder writes the model downgrade, and the steering port records each direction it drains.
      recorded: new Set(['llm.model_downgrade', 'steer.applied'] as const),
    }),
    ship: run.shipPolicy,
    // From here the model policy is the AGENT's: the Brain's guards read `run.policy` (the view's) and report to it through the view.
    attach: (view) => { run.view = view; },
    // A question ends the run before any call dispatches (decided once per turn in `brainTurn.ts`).
    extensions: {
      schemas: () => [],
      handles: () => false,
      dispatch: async () => ({ data: null }),
      terminalTurn: () => {
        if (last.keepFailed !== undefined) throw last.keepFailed;
        const reply = last.terminal;
        last.terminal = undefined;
        return reply;
      },
    },
    steering: brainSteeringSource(run, people),
    ...(spend ? { spend } : {}),
    store: brainRunStorePort(c, { toolRowAppended: platform.toolRowAppended, personSteer: people.take }),
  };
  const transcript = run.convo.map(toRunMessage);
  // The TASK is the person's request: compaction pins it, whatever conversation comes before it.
  const request = transcript.map((row) => row.role).lastIndexOf('user');
  if (request >= 0) transcript[request] = { ...transcript[request]!, task: true };
  const ports = buildBrainRunPorts(binding);
  const signal = c.abort?.signal;
  const outcome = await openRun({
    task: { ...brainRunTask(binding), persona: run.systemPrompt, transcript },
    policy: brainRunPolicy(binding),
    ports: { ...ports, model: withoutUncallableTurns(ports.model, req) },
    // The run's route, decided ONCE in the preamble (`runStore/runRoute.ts`): handed over as decided, so `openRun` folds it and never routes again.
    route: { input: run.route.input, decided: decidedRoute(run.route) },
    surface: {
      // Native history and transport ports; the shared factory owns folding policy.
      compaction: compaction.options,
      // The preamble ran the host's model preflight already (`hostRunContext.ts`): the agent's own would ask the host again and warn
      // about a model the loop never warned about (a QUICK run's quick model). Supply facts; the shared model factory records the verdict.
      preflight: recordedPreflight(c, req.model),
      // The host's engine ports (`brainFinish.ts`): an owner never ends with its sub-agents still working, and the open-work gate
      // sequence holds the run's open linked tickets, then the spec items a ticketing request still owes.
      guards: brainGuardPorts(run),
      finish: brainFinishPorts(req, [openLinkedWorkHold(run), specTicketCoverageGate(run)]),
      // The deterministic close-out (`runStore/deterministicFinish.ts`): the host's own ticket actions, ahead of the finish gate.
      closeOut: closeOutPort(run),
    },
    // The Brain's read-coverage owns the no-progress counter (`callPreflight`/`callPostStep`
    // feed it); hand the kernel that ONE instance to persist, so a circling run keeps its count
    // across the step yield it is steered into — not a kernel-built twin the Brain never feeds.
    cacheStreak: run.cacheStreak,
    ...(signal ? { signal } : {}),
  });
  await settleBrainRun(run, outcome, last);
}
