/**
 * cloudAdapterHooks — the ENGINE PORTS the cloud binds the agent's policy modules with
 * (PRD 35 WS3). The finish gates, the guards and compaction are the agent's
 * (`@builderforce/agent-run`); what each needs from the surface is a coupling — read a
 * committed file, poll branch CI, run the sandbox's checks, park the run on an approval,
 * ask the difficulty router, summarise the dropped middle. This file hands over those
 * couplings and nothing else: it never decides what a gate means or when a guard trips.
 *
 * The run-end VERIFY is not a module here: the cloud verifies after the finish is accepted,
 * as a best-effort note (`cloudRunTail`), exactly as it always did.
 */
import {
  createCompactionHook, createFinishHook, createGuardsHook,
  type GuardPorts, type GuardsHook, type PolicyModules, type RunState,
} from '@builderforce/agent-run';
import type { AgentExecParams } from '@builderforce/agent-tools';
import type { DifficultyFeatures } from '@builderforce/difficulty-router';
import type { TierLadder } from '@builderforce/run-policy';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { recordCascadeOutcome, shouldSkipWeakAttempt, weakPassRate } from '../llm/difficultyGate';
import { ROLE_REASONING_EFFORT, escalateThinkLevel } from '../llm/roleReasoning';
import { isModelRole } from '@builderforce/agent-tools';
import { buildGatewaySummarizer } from '../llm/gatewaySummarizer';
import { readRepoFile } from '../repos/readRepoContents';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { cloudFinishPorts } from './cloudAgent/finishGates';
import type { WrittenFileHashes } from './cloudAgent/writtenFileHashes';
import { recordCloudToolEvent } from './cloudToolEvents';
import { pauseExecutionForQuestion } from './executionPause';
import type { RunSandbox } from './sandbox/runSandbox';
import type { CloudRunRefs } from './cloudAdapterPorts';

export interface CloudHookDeps {
  env: Env;
  db: Db;
  run: CloudRunRefs;
  /** The role the parent loop is billed as (stamped on cascade training rows). */
  runRole: string;
  repoCtx: TicketRepoContext | null;
  /** Every run is a node of a delegation tree (it may spawn; a sub-agent carries its spec). */
  delegated: boolean;
  /** The run's per-file content hashes (the provider records them; the finish gates re-hash a child's rewrites). */
  writtenHashes?: WrittenFileHashes;
  /** The run's live written set — the footprint the containment limits measure. */
  writtenPaths?: Set<string>;
  /** The run's sandbox, when it has one (the project's own fast checks judge a turn's edits). */
  sandbox?: RunSandbox;
  ladder: TierLadder;
  /** The D2 features of the step about to be judged, from the transcript as it stands. */
  features: (step: number, messages: readonly unknown[]) => DifficultyFeatures;
  resolvedModel: () => string | undefined;
  /** The personality's reasoning levers: D1 raises from the persona's level, else the role's default. */
  execParams?: AgentExecParams;
  /** Told the run's live state whenever a guard hook runs. */
  onState?: (state: RunState) => void;
}

const evt = (run: CloudRunRefs) => ({ tenantId: run.tenantId, cloudAgentRef: run.cloudAgentRef, executionId: run.executionId });

/** Guard ports read the run's live state through the hook context, which names it on every call. */
function bindLiveState(inner: GuardsHook, bind: (state: RunState) => void): GuardsHook {
  return {
    ...inner,
    beforeDispatch: (ctx, call) => { bind(ctx.state); return inner.beforeDispatch(ctx, call); },
    observe: (ctx, call, result) => { bind(ctx.state); return inner.observe(ctx, call, result); },
    endTurn: (ctx, content) => { bind(ctx.state); return inner.endTurn?.(ctx, content); },
    isReadOnly: (ctx, name) => { bind(ctx.state); return inner.isReadOnly?.(ctx, name) ?? false; },
    seed: (ctx) => { bind(ctx.state); return inner.seed?.(ctx); },
    reasoning: (ctx) => { bind(ctx.state); return inner.reasoning?.(ctx); },
    finish: (ctx, verdict) => { bind(ctx.state); return inner.finish?.(ctx, verdict) ?? verdict.block; },
  };
}

/**
 * D1/D2's couplings: the difficulty router (would the weak attempt fail, the tenant's prior, the training row a verdict
 * becomes — stamped with the execution it came from) and the reasoning ladder (raised one level per open escalation, from
 * the persona's level else the role's default).
 */
export function cloudCascadePorts(d: Pick<CloudHookDeps, 'env' | 'db' | 'run' | 'runRole' | 'ladder' | 'execParams'>): NonNullable<GuardPorts['cascade']> {
  const { env, db, run } = d;
  return {
    ladder: d.ladder,
    escalateThinkLevel: (level) => escalateThinkLevel(level as never),
    defaultThinkLevel: d.execParams?.thinkLevel ?? (isModelRole(d.runRole) ? ROLE_REASONING_EFFORT[d.runRole] : 'medium'),
    shouldSkipWeakAttempt: (features) => shouldSkipWeakAttempt(env, run.tenantId, features),
    weakPassRate: async (actionType) => (await weakPassRate(env, db, run.tenantId, actionType as never)) ?? undefined,
    recordOutcome: (row) => recordCascadeOutcome(env, db, {
      tenantId: run.tenantId, executionId: String(run.executionId), actionType: row.actionType as never,
      role: d.runRole, weakModel: row.weakModel, passed: row.passed, verifier: row.verifier, features: row.features,
    }),
  };
}

/** The policy modules the cloud binds with its couplings; the rest stay the agent's defaults. */
export function cloudPolicyModules(d: CloudHookDeps): Partial<PolicyModules> {
  const { env, db, run, repoCtx } = d;
  const readCommitted = repoCtx
    ? async (path: string): Promise<string | null> => {
      const read = await readRepoFile({ ...repoCtx, ref: repoCtx.branch }, path);
      return read.ok ? read.content : null;
    }
    : undefined;

  let live: RunState | undefined;
  const liveState = (): RunState => {
    if (!live) throw new Error('the guards ran before the agent named the run state');
    return live;
  };
  const guardPorts: GuardPorts = {
    ...(readCommitted ? { read: readCommitted } : {}),
    bound: repoCtx !== null,
    ...(d.sandbox ? { checks: () => d.sandbox!.checks() } : {}),
    pause: (question) => pauseExecutionForQuestion(env, db, {
      tenantId: run.tenantId, executionId: run.executionId, taskId: run.taskId, projectId: run.projectId,
      ...(run.cloudAgentRef ? { cloudAgentRef: run.cloudAgentRef } : {}), agentLabel: run.agentLabel, question, surface: 'durable',
    }),
    model: { get: () => liveState().model, set: (next) => { liveState().model = next; } },
    resolvedModel: d.resolvedModel,
    ladder: () => d.ladder,
    features: (step) => d.features(step, live?.messages ?? []),
    cascade: cloudCascadePorts(d),
    onEvent: ({ tool, detail, result }) => recordCloudToolEvent(db, { ...evt(run), toolName: tool, category: 'llm', detail, result }),
  };

  return {
    // The dropped middle is summarised on the free pool (or an admitted specialist — E2, which resolves per tenant).
    compaction: createCompactionHook({ summarize: (text) => buildGatewaySummarizer(env)(text, { tenantId: run.tenantId }) }),
    guards: bindLiveState(createGuardsHook(guardPorts), (state) => { live = state; d.onState?.(state); }),
    // The same couplings the cloud's `evaluateFinishGates` entry binds (one definition: `cloudAgent/finishGates`).
    finish: createFinishHook(cloudFinishPorts({ db, evt: run, repoCtx, delegated: d.delegated, ...(d.writtenHashes ? { writtenHashes: d.writtenHashes } : {}), ...(d.writtenPaths ? { writtenPaths: d.writtenPaths } : {}) })),
  };
}
