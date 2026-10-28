/**
 * cloudAdapter — the CLOUD adapter of the one agent (PRD 35 WS3, §3.1/§4).
 *
 * The ONE importer of `runAgent` on the cloud surface. It BUILDS PORTS from the
 * cloud runtime host and maps the run outcome back to the surfaces the cloud owns:
 * the CloudRunnerDO alarm tick (one step per tick, resume from the DO cursor), the
 * board-dispatched ticket run (signoff + approval gates), and the Brain @-reply.
 *
 * It has NO loop, NO policy module and NO branch on behaviour — every behaviour
 * difference arrives through the ports the host supplies and the `RunPolicy` the
 * board compiled. `RunPolicy.entryPoint` is a telemetry label only and is never
 * read here beyond passing it through.
 *
 * Port sources (WS3 §4):
 *   model        — the host's metered gateway `complete` (cloudAgent/cloudLlmTurn
 *                  records usage + trace per turn; the DO tick decorates it with
 *                  recordCloudLlmTurn, the @-reply's caller already meters it);
 *   capabilities — cloudAgent/runProvider.ts (git API + sandbox + IDE workspace,
 *                  rehearsal as a decorator) for the tick, the chat-scoped platform
 *                  toolset for the @-reply;
 *   store        — the DO cursor (tick) / ephemeral (@-reply, which settles in one
 *                  invocation);
 *   events       — the run timeline (cloudToolEvents), telemetry-grade best-effort;
 *   human        — executionPause.pauseExecutionForQuestion (the durable surface
 *                  parks the run until /resume);
 *   steering     — executionSteering.pullPendingSteering (pre-drained once per tick:
 *                  a tick is one step, so one drain at build time is the same thing);
 *   context      — runContextSource.assembleRunContext, built once before turn 1
 *                  with NO model call (§6.10).
 */
import { runAgent } from '@builderforce/agent-run';
import type {
  CapabilityProvider,
  ContextPack,
  EventSink,
  HumanChannel,
  ModelCompletion,
  ModelTransport,
  PolicyGate,
  RunEvent,
  RunOutcome,
  RunPolicy,
  RunPorts,
  RunState,
  RunTask,
} from '@builderforce/agent-run';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { recordCloudLlmTurn } from './cloudAgent/cloudLlmTurn';
import type { LlmProxyService } from '../llm/LlmProxyService';
import { composeRunProvider } from './cloudAgent/runProvider';
import type { RunSandbox } from './sandbox/runSandbox';
import { pauseExecutionForQuestion } from './executionPause';
import { pullPendingSteering } from './executionSteering';
import { recordCloudToolEvent } from './cloudToolEvents';
import { assembleRunContext } from './runContextSource';

/** What the host hands the adapter. Everything behaviour-bearing is supplied here. */
export interface CloudRunHost {
  env: Env;
  db: Db;
  run: {
    tenantId: number;
    projectId: number;
    taskId: number;
    executionId: number;
    cloudAgentRef?: string;
    agentLabel: string;
  };
  /** The run's prompt (board ticket text or chat reply request). */
  prompt: string;
  /** Board-dispatch provenance + gates compiled by the board (§6.9). */
  dispatch?: RunTask['dispatch'];
  signoff?: RunPolicy['signoff'];
  approvalGates?: readonly PolicyGate[];
  /** The tier-ladder role this run executes as. */
  role: string;
  /** The surface's built provider (git API + platform tools). */
  capabilities: CapabilityProvider;
  repoCtx: TicketRepoContext | null;
  sandbox?: RunSandbox;
  signal: AbortSignal;
  heartbeat: () => Promise<unknown>;
  decorate?: (provider: CapabilityProvider) => CapabilityProvider;
  writtenPaths: Set<string>;
  /** DO cursor persistence: save the resume state at each step boundary. */
  save: (state: RunState) => Promise<void> | void;
  /** The DO cursor's saved state, to resume from. */
  resume?: RunState;
  /** The tool scope this run drives: a ticket run or an @-reply. */
  toolScope: 'ticket' | 'chat-reply';
  /** The chat an @-reply answers in, when toolScope is 'chat-reply'. */
  chatId?: number | string;
  /** A metered model call: the gateway `complete`, usage already recorded by the host. */
  model: ModelTransport;
  /** Steers already drained for this tick (the DO drains before it builds the run). */
  steers?: string[];
}

/** The cloud-shaped result every cloud surface already knows how to settle. */
export interface CloudAdapterResult {
  ok: boolean;
  output: string;
  cancelled: boolean;
  /** Terminal when the run finished/failed/cancelled; false ⇒ `state` resumes next tick. */
  finished: boolean;
  state?: RunState;
  /** Set when the run parked on a human question (NOT terminal — /resume wakes it). */
  awaitingInput?: { approvalId: string; question: string };
}

/** The shared outcome mapping: one RunOutcome → the cloud result shape. */
function mapOutcome(outcome: RunOutcome): CloudAdapterResult {
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

/** The run timeline: every trace event lands as one best-effort tool-audit row. */
function timelineSink(host: CloudRunHost, role: string): EventSink {
  const base = {
    tenantId: host.run.tenantId,
    ...(host.run.cloudAgentRef ? { cloudAgentRef: host.run.cloudAgentRef } : {}),
    executionId: host.run.executionId,
  };
  return {
    emit(event: RunEvent) {
      return recordCloudToolEvent(host.db, {
        ...base,
        toolName: `run.${event.kind}`,
        category: 'run',
        detail: { ...event, role },
      }).catch(() => undefined);
    },
  };
}

/** The durable human channel: a question parks the run until /resume answers it. */
function durableHumanChannel(host: CloudRunHost): HumanChannel {
  const ask = async (question: string) => {
    await pauseExecutionForQuestion(host.env, host.db, {
      tenantId: host.run.tenantId,
      executionId: host.run.executionId,
      taskId: host.run.taskId,
      projectId: host.run.projectId,
      ...(host.run.cloudAgentRef ? { cloudAgentRef: host.run.cloudAgentRef } : {}),
      agentLabel: host.run.agentLabel,
      question,
      surface: 'durable',
    });
    return { kind: 'paused' as const };
  };
  return { ask, approve: (gate) => ask(`${gate.tool ?? 'act'} requires approval: ${gate.summary ?? gate.id}`) };
}

/** The platform context pack, assembled once before turn 1 with NO model call (§6.10). */
async function cloudContextPack(host: CloudRunHost, task: RunTask): Promise<ContextPack> {
  const envelope = await assembleRunContext(host.env, host.db, {
    tenantId: host.run.tenantId,
    projectId: host.run.projectId,
    taskId: host.run.taskId,
    ...(host.run.cloudAgentRef ? { agentRef: host.run.cloudAgentRef } : {}),
    query: task.prompt,
  });
  return {
    focus: [],
    facts: envelope.blocks.map((b) => ({ key: b.subject, content: b.body })),
    recall: [],
  };
}

/**
 * Run one cloud run through the one agent.
 *
 * The DO calls this once per alarm tick with `maxSteps: 1` and the cursor's saved
 * state; the Worker surface calls it unbounded in one invocation. Both produce the
 * same trace — the resume state is plain JSON in the DO cursor.
 */
export async function runCloudAgent(host: CloudRunHost, maxSteps?: number): Promise<CloudAdapterResult> {
  const task: RunTask = {
    prompt: host.prompt,
    ticketId: host.run.taskId,
    projectId: host.run.projectId,
    ...(host.chatId !== undefined ? { chatId: host.chatId } : {}),
    dispatch: host.dispatch ?? { source: 'manual' },
  };
  const policy: RunPolicy = {
    entryPoint: 'cloud',
    toolScope: host.toolScope,
    role: host.role,
    levers: [],
    budgets: {},
    inference: 'hybrid',
    verify: 'declared-checks',
    ...(host.signoff ? { signoff: host.signoff } : {}),
    approvalGates: [...(host.approvalGates ?? [])],
    delegation: { requested: false, readsBeforeNudge: 6 },
  };

  const provider = (
    await composeRunProvider({
      env: host.env,
      db: host.db,
      built: host.capabilities,
      repoCtx: host.repoCtx,
      run: {
        tenantId: host.run.tenantId,
        taskId: host.run.taskId,
        executionId: host.run.executionId,
        agentLabel: host.run.agentLabel,
        ...(host.run.cloudAgentRef ? { cloudAgentRef: host.run.cloudAgentRef } : {}),
        writtenPaths: host.writtenPaths,
      },
      ...(host.sandbox ? { sandbox: host.sandbox } : {}),
      signal: host.signal,
      heartbeat: host.heartbeat,
      ...(host.decorate ? { decorate: host.decorate } : {}),
    })
  ).provider;

  let steers = host.steers ?? [];
  const ports: RunPorts = {
    model: host.model,
    capabilities: provider,
    store: {
      load: () => host.resume,
      save: (state) => host.save(state),
    },
    events: timelineSink(host, host.role),
    human: durableHumanChannel(host),
    steering: { drain: () => {
      const drained = steers;
      steers = [];
      return drained;
    } },
    context: { pack: (t) => cloudContextPack(host, t) },
  };

  const outcome = await runAgent({ task, policy, ports, ...(host.resume ? { resume: host.resume } : {}), ...(maxSteps !== undefined ? { maxSteps } : {}), signal: host.signal });
  return mapOutcome(outcome);
}
