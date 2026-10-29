/**
 * webAdapter — the Brain's surfaces adapted to the ONE agent (PRD 35 §3.1 / §4 WS4).
 *
 * Web, Rovr and — through its own thin adapter (`clients/vscode/src/run/vscodeAdapter.ts`) —
 * the editor run the same code here. An adapter ONLY builds ports and the policy DATA:
 * it has no loop, no branch on behaviour and no policy. `RunPolicy.entryPoint` is the label
 * the outcome row carries (`'web'` / `'rovr'` / `'vscode'`); nothing reads it to decide what
 * the run does.
 *
 * Every port is the Brain's existing machinery, wrapped (`./modelTransport.ts`,
 * `./eventSink.ts`, `./runStorePort.ts`, `./humanChannel.ts`, `./contextSource.ts`), and the
 * steering port is the run-keyed composer queue the agent owns
 * (`@builderforce/agent-run` `runSteeringSource`) — the same inbox `queueRunSteering` posts to.
 */

import {
  asksForSubagents,
  runSteeringSource,
  type CapabilityProvider,
  type PolicyGate,
  type RunPolicy,
  type RunPorts,
  type RunTask,
} from '@builderforce/agent-run';
import type { CostLeverId } from '@builderforce/cost-levers';
import { deviceLeverOn } from '../runStore/deviceLevers';
import type { RunCell } from '../runStore/runCell';
import type { BrainRunRequest } from '../runStore/runTypes';
import { brainContextSource, type GatherContextPack } from './contextSource';
import { brainEventSink, type OutcomeReport } from './eventSink';
import { brainHumanChannel } from './humanChannel';
import { brainModelTransport, type BrainCallDefaults } from './modelTransport';
import { cellRunStore } from './runStorePort';

/** The telemetry label of the surface the run came in through. */
export type BrainEntryPoint = 'web' | 'rovr' | 'vscode';

/** The delegation nudge fires after this many reads with no spawn (PRD 35 §3.2). */
const READS_BEFORE_NUDGE = 6;

/** The guard levers a Brain run reads on the device (`COST_LEVER_<ID>=off` turns one off). */
const GUARD_LEVERS: readonly CostLeverId[] = ['a3_progress_detector'];

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
  /** How many of the cell's transcript rows open the run (the store appends after them). */
  seeded?: number;
  /** The host's richer structured context pack, when it gathers more than the served files. */
  gatherContext?: GatherContextPack;
  /** The streamed deltas / serving model / connect retries go here — the live view. */
  handlers?: Parameters<typeof brainModelTransport>[0]['handlers'];
  /** Per-call routing the request fixed for the whole run. */
  call?: BrainCallDefaults;
  /** The host's run-end memory commit (codemap facts, the session note). */
  commitMemory?: (consolidated: unknown) => Promise<void> | void;
  /** Where the uniform outcome row goes. */
  reportOutcome?: OutcomeReport;
  /** Governance gates compiled for this run — the human channel's approvals. */
  approvalGates?: readonly PolicyGate[];
}

/** The ports of one Brain run — built from the request, deciding nothing. */
export function buildBrainRunPorts(b: BrainRunBinding): RunPorts {
  const { req, cell, runKey } = b;
  return {
    model: brainModelTransport({
      stream: req.stream,
      ...(b.handlers ? { handlers: b.handlers } : {}),
      call: {
        ...(req.routingMode ? { routingMode: req.routingMode } : {}),
        ...(req.modelStrict != null ? { modelStrict: req.modelStrict } : {}),
        ...(req.reasoning ? { reasoning: req.reasoning } : {}),
        ...b.call,
      },
      ...(req.windowSources ? { windows: req.windowSources } : {}),
      ...(req.modelPreflight ? { preflight: req.modelPreflight } : {}),
    }),
    capabilities: b.capabilities,
    store: cellRunStore(cell, { ...(b.seeded !== undefined ? { seeded: b.seeded } : {}), ...(b.commitMemory ? { commitMemory: b.commitMemory } : {}) }),
    events: brainEventSink(cell, b.reportOutcome),
    human: brainHumanChannel(runKey),
    steering: runSteeringSource(runKey),
    context: brainContextSource(req, b.gatherContext),
  };
}

/** The task of one Brain run. */
export function brainRunTask(b: Pick<BrainRunBinding, 'req' | 'request'>, defaultRepo?: string): RunTask {
  const { req } = b;
  return {
    prompt: b.request,
    ...(req.serverChatId != null ? { chatId: req.serverChatId } : {}),
    ...(req.projectId != null ? { projectId: req.projectId } : {}),
    dispatch: req.lineage ? { source: 'subagent', parentRunId: String(req.lineage.ownerKey) } : { source: 'chat' },
    ...(defaultRepo ? { workspace: { defaultRepo } } : {}),
  };
}

/**
 * The policy DATA of one Brain run. Every field is read off the request or the device —
 * the same facts the Brain's own loop reads — and none selects behaviour by surface.
 */
export function brainRunPolicy(b: Pick<BrainRunBinding, 'entryPoint' | 'req' | 'request' | 'approvalGates'>): RunPolicy {
  const { req } = b;
  return {
    entryPoint: b.entryPoint,
    toolScope: req.lineage ? 'subagent' : req.chatMode === 'chat' ? 'chat-reply' : 'chat-work',
    role: 'general',
    levers: GUARD_LEVERS.filter((id) => deviceLeverOn(id)),
    // A Brain run has NO tool-iteration ceiling: the kernel's consecutive-failure breaker
    // is its only limit (`runStore/runLoop.ts`).
    budgets: {},
    ...(req.model && req.modelStrict ? { pinnedModel: req.model } : {}),
    inference: 'hybrid',
    verify: 'none',
    approvalGates: [...(b.approvalGates ?? [])],
    delegation: { requested: asksForSubagents(b.request), readsBeforeNudge: READS_BEFORE_NUDGE },
  };
}
