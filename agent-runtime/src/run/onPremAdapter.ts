/**
 * onPremAdapter — the ON-PREM adapter of the one agent (PRD 35 WS5, §3.1/§4).
 *
 * The ONE importer of `runAgent` on the on-prem surface (tickets, channels, cron).
 * It BUILDS PORTS from the on-prem runtime host and maps the run outcome back to
 * the surfaces the on-prem host owns: the ticket dispatch, the channel reply and
 * the cron tick — all of which call `runAgent` through this seam.
 *
 * It has NO loop, NO policy module and NO branch on behaviour — every behaviour
 * difference arrives through the ports the host supplies and the `RunPolicy` the
 * host compiled. `RunPolicy.entryPoint` is a telemetry label only and is never
 * read here beyond passing it through.
 *
 * Port sources (WS5 §4):
 *   model        — the host's model transport (the on-prem engine's `complete`;
 *                  node fs + shell plus the native AgentTools stay the host's job);
 *   capabilities — `buildNodeCapabilityProvider` (node fs + shell, the native
 *                  on-prem disk capability set, shared `@builderforce/agent-tools`
 *                  definitions);
 *   store        — the session file (`SessionManager`, the run's state lives in the
 *                  session file on disk; `commitMemory` writes the consolidated
 *                  memory the run produced back through the host);
 *   events       — relay frames: the typed `RunEvent` stream goes out as
 *                  `sendToRelay` frames on the upstream socket, best-effort;
 *   human        — the process-wide approval gate (`requestHumanInput`), the same
 *                  human-in-the-loop seam the native `ask_human` tool uses;
 *   steering     — the host's inbound-steer buffer, drained once per run boundary
 *                  (a ticket/channel run is one invocation; the drain at build time
 *                  is the same thing);
 *   context      — the host's context pack, built once before turn 1 with NO model
 *                  call (§6.10).
 */

import { runAgent } from "@builderforce/agent-run";
import type {
  CapabilityProvider,
  ContextPack,
  EventSink,
  HumanChannel,
  ModelTransport,
  RunEvent,
  RunOutcome,
  RunPolicy,
  RunPorts,
  RunState,
  RunTask,
} from "@builderforce/agent-run";
import { buildNodeCapabilityProvider } from "../agents/node-capability-provider.js";
import type { NodeWriteScope } from "../agents/node-capability-provider.js";
import type { SessionManager } from "../builderforce/agent-loop/session-manager.js";

/** What the host hands the adapter. Everything behaviour-bearing is supplied here. */
export interface OnPremRunHost {
  /** Absolute working-tree root; the disk provider scopes list/search inside it. */
  workspaceRoot: string;
  /** Write confinement for per-file read/write/edit/delete (secure default: workspace). */
  scope?: NodeWriteScope;
  /** The run's prompt (ticket text, channel message or cron instruction). */
  prompt: string;
  /** Ticket/channel/cron provenance. */
  dispatch?: RunTask['dispatch'];
  /** The surface's built model transport (usage already recorded by the host). */
  model: ModelTransport;
  /** The tier-ladder role this run executes as. */
  role: string;
  /** Optional pre-built capability provider (defaults to the disk provider over fs+shell). */
  capabilities?: CapabilityProvider;
  /** The session file the run's state lives in. */
  session: SessionManager;
  /** Relay-frame sender: the typed run events go out over the upstream socket. */
  sendToRelay: (frame: unknown) => boolean;
  /** Ask a human through the process-wide approval gate; resolves inline or parks. */
  askHuman?: HumanChannel['ask'];
  /** Steers already drained for this invocation. */
  steers?: string[];
  /** The context pack, built once before turn 1 with NO model call (§6.10). */
  context?: ContextSourceLike;
  /** The session file's saved state, to resume from (a prior tick / a paused run). */
  resume?: RunState;
  /** Persist the resume state at each step boundary (the session file). */
  save?: (state: RunState) => Promise<void> | void;
  /** The consolidated memory the run produced, committed at run end. */
  commitMemory?: (consolidated: unknown) => Promise<void> | void;
}

/** A host-supplied context source (the contract's `ContextSource` shape). */
interface ContextSourceLike {
  pack(task: RunTask): Promise<ContextPack> | ContextPack;
}

/** The on-prem-shaped result every on-prem surface already knows how to settle. */
export interface OnPremAdapterResult {
  ok: boolean;
  output: string;
  cancelled: boolean;
  /** Terminal when the run finished/failed/cancelled; false ⇒ `state` resumes later. */
  finished: boolean;
  state?: RunState;
  /** Set when the run parked on a human question (NOT terminal — the answer resumes it). */
  awaitingInput?: { approvalId: string; question: string };
}

/** The shared outcome mapping: one RunOutcome → the on-prem result shape. */
function mapOutcome(outcome: RunOutcome): OnPremAdapterResult {
  switch (outcome.kind) {
    case 'finished':
      return { ok: true, output: outcome.output, cancelled: false, finished: true, state: outcome.state };
    case 'paused':
      return {
        ok: true, output: '', cancelled: false, finished: false, state: outcome.state,
        awaitingInput: { approvalId: outcome.approvalId, question: outcome.question },
      };
    case 'yielded':
      return { ok: true, output: '', cancelled: false, finished: false, state: outcome.state };
    case 'failed':
      return {
        ok: false, output: outcome.reason, cancelled: outcome.reason === 'cancelled',
        finished: true, state: outcome.state,
      };
  }
}

/** The relay-frame event sink: every trace event goes out as one best-effort frame. */
function relayEventSink(host: OnPremRunHost): EventSink {
  return {
    emit(event: RunEvent) {
      // Best-effort: a closed socket drops the frame, never the run.
      host.sendToRelay({ type: "run.event", event });
      return undefined;
    },
  };
}

/** The on-prem human channel: the process-wide approval gate answers inline. */
function onPremHumanChannel(host: OnPremRunHost): HumanChannel {
  const ask = host.askHuman ?? (async (_question: string) => ({ kind: 'paused' as const }));
  return { ask };
}

/**
 * Run one on-prem run (ticket, channel or cron) through the one agent.
 *
 * Every on-prem surface calls this one seam. A cron tick may invoke it with
 * `maxSteps: 1` and the session file's saved state; a ticket/channel run calls it
 * unbounded in one invocation. Both produce the same trace — the resume state is
 * plain JSON in the session file.
 */
export async function runOnPremAgent(host: OnPremRunHost, maxSteps?: number): Promise<OnPremAdapterResult> {
  const task: RunTask = {
    prompt: host.prompt,
    dispatch: host.dispatch ?? { source: 'manual' },
    ...(host.workspaceRoot ? { workspace: { defaultRepo: host.workspaceRoot } } : {}),
  };
  const policy: RunPolicy = {
    entryPoint: 'on-prem',
    toolScope: 'ticket',
    role: host.role,
    levers: [],
    budgets: {},
    inference: 'hybrid',
    verify: 'declared-checks',
    approvalGates: [],
    delegation: { requested: false, readsBeforeNudge: 6 },
  };

  const capabilities =
    host.capabilities ??
    buildNodeCapabilityProvider({ workspaceRoot: host.workspaceRoot, scope: host.scope });

  // persistLeaf() rewrites the session transcript file to end at the current leaf —
  // the host's step persistence hook; a RunState save is the host's job when resuming
  // is wanted, so it is supplied via `host.save`/`host.resume`.
  const save = host.save ?? (() => host.session.persistLeaf());
  const store: RunPorts['store'] = {
    load: () => host.resume,
    save,
    ...(host.commitMemory ? { commitMemory: (c: unknown) => host.commitMemory!(c) } : {}),
  };

  let steers = host.steers ?? [];
  const ports: RunPorts = {
    model: host.model,
    capabilities,
    store,
    events: relayEventSink(host),
    human: onPremHumanChannel(host),
    steering: {
      drain: () => {
        const drained = steers;
        steers = [];
        return drained;
      },
    },
    context: {
      pack: (t) =>
        host.context?.pack(t) ?? { focus: [], facts: [], recall: [] },
    },
  };

  const outcome = await runAgent({
    task,
    policy,
    ports,
    ...(host.resume ? { resume: host.resume } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  });
  return mapOutcome(outcome);
}
