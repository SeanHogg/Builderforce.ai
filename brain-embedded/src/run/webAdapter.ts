/**
 * webAdapter — the Brain's surfaces adapted to the ONE agent (PRD 35 §3.1 / §4 WS4).
 *
 * Web, Rovr and the editor run the same code here. An adapter ONLY builds ports and the policy DATA:
 * it has no loop, no branch on behaviour and no policy. `RunPolicy.entryPoint` is the label
 * the outcome row carries (`'web'` / `'rovr'` / `'vscode'`); nothing reads it to decide what
 * the run does.
 *
 * Every port is the Brain's existing machinery, wrapped (`./modelTransport.ts`, `./humanChannel.ts`, `./contextSource.ts`), or one the
 * caller builds over the run's cell and hands in: the event sink (`./eventSink.ts`), the run store (`./loopStore.ts`) and the steering
 * source (`./loopSteering.ts`, over the run-keyed composer queue the agent owns).
 */

import {
  type CapabilityProvider,
  type DeliveryLedger,
  type EventSink,
  type PlatformTools,
  type ToolExtension,
  type PolicyGate,
  type RunStore,
  type RunView,
  type SteeringSource,
  type RunPolicy,
  type RunPorts,
  type SpendMeter,
  type RunTask,
} from '@builderforce/agent-run';
import type { RunPolicyOptions } from '@builderforce/run-policy';
import { CODE_CHANGE_TOOLS } from '../localWorkspaceTools';
import type { RunCell } from '../runStore/runCell';
import type { BrainRunRequest } from '../runStore/runTypes';
import { brainContextSource } from './contextSource';
import { brainHumanChannel } from './humanChannel';
import { brainModelRules } from './brainModelRules';
import { brainModelTransport, type TurnObserver } from './modelTransport';

/** The telemetry label of the surface the run came in through. */
export type BrainEntryPoint = 'web' | 'rovr' | 'vscode';

/** Everything an adapter needs to build the ports of ONE Brain run. */
export interface BrainRunBinding {
  /** Which surface: the telemetry label. Never a switch. */
  entryPoint: BrainEntryPoint;
  /** The run's cell (its live view, single-flight claim and transcript). */
  cell: RunCell;
  /** The cell's key — also the key of the run's steering inbox. */
  runKey: number;
  /** The request the host handed the run. */
  req: BrainRunRequest;
  /** What the surface can physically do: its tool catalog as capabilities. */
  capabilities: CapabilityProvider;
  /** The user's own words for this run. */
  request: string;
  /** Governance gates compiled for this run — the human channel's approvals. */
  approvalGates?: readonly PolicyGate[];
  /** The surface's live view and record of each turn (`loopTurn.ts`). */
  turn?: TurnObserver;
  /** Tools the surface runs beside the registry's, and the turns that end the run before a call dispatches. */
  extensions?: ToolExtension;
  /** How the run's model hand-off starts (`pipelinePolicyOptions`): the phase it begins in, the stage models, and the quick model a routed QUICK run seeds. */
  start?: Pick<RunPolicyOptions, 'startPhase' | 'phaseModels' | 'pinnedModel'>;
  /** Where the run's events go (`eventSink.ts`; the surface reacts to some beyond rendering them, `loopTurn.ts`). */
  events: EventSink;
  /** Told the live run once, before turn 1: the surface reads the model policy from it. */
  attach?: (view: RunView) => void;
  /** What the task still owes when a turn ends in prose (`brainDelivery.ts`). */
  delivery?: DeliveryLedger;
  /** The surface's own tools, when it runs them itself (`brainPlatformTools.ts`). */
  platform?: PlatformTools;
  /** Where the run's steered direction comes from, recorded as it is read (`loopSteering.ts`). */
  steering: SteeringSource;
  /** Where the run's state lives: the surface's own log (`loopStore.ts`). */
  store: RunStore;
  /** The run tree's spend, when the surface shares one total across a run and its sub-agents (`loopSpend.ts`). */
  spend?: SpendMeter;
}

/** The ports of one Brain run — built from the request, deciding nothing. */
export function buildBrainRunPorts(b: BrainRunBinding): RunPorts {
  const { req, runKey } = b;
  return {
    model: brainModelRules(brainModelTransport({
      stream: req.stream,
      ...(b.turn ? { turn: b.turn } : {}),
      call: {
        ...(req.routingMode ? { routingMode: req.routingMode } : {}),
        ...(req.modelStrict != null ? { modelStrict: req.modelStrict } : {}),
        ...(req.reasoning ? { reasoning: req.reasoning } : {}),
      },
      // What the host knows about model windows. A surface with its own compaction (`modules.compaction`, `loopFold.ts`) and its own turn
      // fit (`windowFit.prepare`, its `llm.handoff` step) loses nothing by saying it: the agent sizes a tool result from it.
      ...(req.windowSources ? { windows: req.windowSources } : {}),
      ...(req.modelPreflight ? { preflight: req.modelPreflight } : {}),
    }), req),
    capabilities: b.capabilities,
    store: b.store,
    ...(b.platform ? { platform: b.platform } : {}),
    ...(b.delivery ? { delivery: b.delivery } : {}),
    ...(b.attach ? { attach: b.attach } : {}),
    ...(b.spend ? { spend: b.spend } : {}),
    ...(b.extensions ? { extensions: b.extensions } : {}),
    events: b.events,
    human: brainHumanChannel(runKey),
    steering: b.steering,
    context: brainContextSource(),
  };
}

/** The task of one Brain run. */
export function brainRunTask(b: Pick<BrainRunBinding, 'req' | 'request'>): RunTask {
  const { req } = b;
  return {
    prompt: b.request,
    ...(req.serverChatId != null ? { chatId: req.serverChatId } : {}),
    ...(req.projectId != null ? { projectId: req.projectId } : {}),
    dispatch: req.lineage ? { source: 'subagent', parentRunId: String(req.lineage.ownerKey) } : { source: 'chat' },
  };
}

/**
 * The policy DATA of one Brain run. Every field is read off the request or the device —
 * the same facts the Brain's preamble reads — and none selects behaviour by surface.
 */
export function brainRunPolicy(b: Pick<BrainRunBinding, 'entryPoint' | 'req' | 'request' | 'approvalGates' | 'start'>): RunPolicy {
  const { req } = b;
  const seed = b.start?.pinnedModel ?? req.model;
  return {
    entryPoint: b.entryPoint,
    // Both modes offer the full catalog (`runPreamble.ts`): the mode changes the directive the model reads, never the menu.
    toolScope: req.lineage ? 'subagent' : 'chat-work',
    role: 'general',
    // No guard lever is switched on in the agent's own policy: A3's detector (and its device lever) is the Brain's
    // `RunProgressGuard`, which the platform tools run, so the run has ONE detector (`brainPlatformTools.ts`).
    levers: [],
    // A Brain run has NO tool-iteration ceiling: the kernel's consecutive-failure breaker
    // is its only limit (`@builderforce/agent-loop`'s `DEFAULT_TOOL_FAILURE_STREAK`).
    budgets: req.maxRunBudgetUsd && req.maxRunBudgetUsd > 0 ? { usd: req.maxRunBudgetUsd } : {},
    codeChangeTools: [...CODE_CHANGE_TOOLS],
    ...(req.model && req.modelStrict ? { pinnedModel: req.model } : {}),
    // The person's Stop is the composer's button: a steered "stop" is words to the model, never a command the run obeys.
    stopWords: false,
    // The Brain's hand-off: a plain policy that starts in the phase the run's role and route say, on the stage models the host chose.
    // The model a routed QUICK run seeds (its quick model, over a soft model) outranks the request's own, as the preamble's policy has it.
    ...(b.start ? { modelStart: { plain: true, ...(seed ? { model: seed } : {}), strict: !!req.modelStrict, ...(b.start.startPhase ? { startPhase: b.start.startPhase } : {}), ...(b.start.phaseModels ? { phaseModels: b.start.phaseModels } : {}) } } : {}),
    inference: 'hybrid',
    verify: 'none',
    approvalGates: [...(b.approvalGates ?? [])],
    // A model that spent its whole stall budget still describing calls ends the run on what it said,, the reason beside it (`brainDelivery.ts`).
    stallExhausted: 'settle',
    // The Brain's delegation gate (`earlyDelegation.ts` on the read result, the delivery ledger's rung at the end) is the run's ONE
    // gate: the agent's own early nudge and backstop stay off, or each read and each prose answer would be judged twice.
    delegation: { requested: false, readsBeforeNudge: 0 },
  };
}
