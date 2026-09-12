/**
 * The canonical cloud-run dispatcher — create AND start a run for a ticket.
 *
 * This is the ONE choke point every autonomous cloud entry funnels through (the
 * lane trigger, the lane requirement gate, the AI Manager, the validator /
 * security / incident dispatchers, the CI-webhook auto-fix loop, plus the HTTP
 * submit routes), which is why the backpressure guards live here rather than in
 * any one caller — see {@link dispatchCloudRunForTask}.
 *
 * WHY IT IS IN THE APPLICATION LAYER. It used to live in
 * `presentation/routes/runtimeRoutes`, and six application modules imported it
 * from there — an inverted dependency arrow that made an HTTP adapter
 * load-bearing for business logic, froze the route file against being split, and
 * kept a latent import cycle alive (`check-application-layering` is the ratchet
 * that froze it). Nothing here needs a request: it takes `env`, `db`, the
 * runtime service and a `waitUntil`, exactly as its non-HTTP callers always
 * supplied them. The routes now import it from here like everyone else.
 */
import { and, eq } from 'drizzle-orm';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { resolveDefaultRepoForTask } from '../repos/resolveDefaultRepo';
import { dispatchGithubActionsRun, githubActionsAvailable } from './githubActionsDispatch';
import { RuntimeService } from './RuntimeService';
import {
  resolveCloudSurface, chooseCloudExecutor, probeContainerHealth, cloudAgentTypeLabel,
  isTerminalExecutionStatus, parseCloudAgentRef, parseRepoId, withDefaultModel, withExecutor,
} from './cloudDispatch';
import { launchContainerRun, type ContainerRunTarget } from './containerRunLauncher';
import { resolveArtifacts } from '../artifact/resolveArtifacts';
import { notifyExecutionSubscribers } from './executionEvents';
import {
  markCloudExecutionRunning, recordCloudToolEvent, resolveCloudAgent, agentAllowsHostExecution,
} from './cloudAgentEngine';
import { resolveDefaultCloudAgentRef, UNATTRIBUTED_RUN_MESSAGE } from './defaultCloudAgent';
import { recordAutoRunSkip, clearAutoRunSkip } from './autoRunSkipLedger';
import { enforceCloudRunCap, type CloudRunCapResult } from './cloudRunLedger';
import { assessRerunBackoff, AUTO_RUN_REASON_TEXT, type AutoRunReason } from '../swimlane/evaluateAutoRun';
import { resolveProjectInferenceModel } from '../llm/projectEvermind';
import { authorizeManagedTaskExecution } from '../kanban/managedExecutionGuard';
import { markLifecycleNeutral, describeAuthority, MANAGED_OVERRIDE_EVENT } from './executionAuthority';
import type { ExecutionReadMemo } from './executionReadMemo';
import { ExecutionStatus } from '../../domain/shared/types';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, executions, projectRepositories, projects, tasks } from '../../infrastructure/database/schema';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';

/**
 * The dispatcher's binding surface: the platform `Env` plus the On-Prem host
 * relay Durable Object. Declared here rather than imported from the route module
 * so the dependency arrow stays inward.
 */
export type DispatchEnv = Env & {
  AGENT_HOST_RELAY?: DurableObjectNamespace<AgentHostRelayDO>;
};

export type DispatchMessage = {
  type: 'task.assign' | 'task.broadcast';
  executionId: number;
  taskId: number;
  payload?: string;
  /** Agent runtime engine resolved from the run-target cloud agent (default v1). */
  engine?: string;
  /** Human label of the executing cloud agent (change traceability). */
  agentLabel?: string;
  /** Repo bound to the task's project, for cloning into the ticket workspace. */
  repo?: { repoId: string; defaultBranch: string | null };
  task: {
    title: string;
    description?: string | null;
  };
  artifacts?: ResolvedArtifacts;
};

export type ExecutionTaskRow = {
  id: number;
  title: string;
  description: string | null;
  assignedAgentHostId: number | null;
  /** ide_agents.id of the cloud agent assigned to this ticket (the swimlane's
   *  agent). The authoritative cloud-agent identity for an "Auto" run when the
   *  caller doesn't pin one in the payload. */
  assignedAgentRef: string | null;
  /** users.id of the human who OWNS this ticket, if any. The swimlane agent that
   *  executes a stage must not seize ownership from an existing assignee (human or
   *  agent) — used to decide whether a run may claim an otherwise-unowned ticket. */
  assignedUserId: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  projectId: number;
};

export async function dispatchToAgentHost(env: DispatchEnv, agentHostId: number, message: DispatchMessage): Promise<boolean> {
  if (!env.AGENT_HOST_RELAY) return false;
  const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(agentHostId)));
  const response = await stub.fetch('https://relay.internal/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  return response.ok;
}

/** Minimal structural shape of a domain Execution returned by RuntimeService. */
export type SubmittedExecution = { id: number; status: string; toPlain(): unknown };

/**
 * Context-free dispatch: create AND start a cloud run for a task. Used by every
 * non-HTTP dispatcher (the lane trigger, the lane requirement gate's reviewer /
 * producer runs, the AI Manager, the validator / security / incident dispatchers,
 * the CI-webhook auto-fix loop). Returns the new execution id, or — when it refuses —
 * a {@link CloudDispatchRefusal} naming WHICH of its guards declined and what would
 * clear it, so no caller has to guess (see that type for the failure that motivated it).
 *
 * ── THIS IS WHERE BACKPRESSURE LIVES ────────────────────────────────────────────
 * The consecutive-failure breaker and the re-run cooldown used to sit inside
 * `evaluateTaskAutoRun`, which only the lane trigger consults — so the nine other
 * callers below dispatched with no backpressure whatsoever. Measured on task 467:
 * 134 runs, all failing on the same cloud-run-cap message, every five minutes, with
 * a three-strike breaker that never saw one of them.
 *
 * Both guards therefore run HERE, at the single choke point every autonomous cloud
 * entry already funnels through, so a dispatch path cannot opt out of them by
 * construction. `force` is the deliberate, explicit override for a HUMAN-initiated
 * dispatch (Run now, a manager approving a held run, "fix with agent") — a person
 * clicking is the same override the breaker always honoured.
 *
 * The cloud-run cap is NOT subject to `force`: it is a billing entitlement, not
 * backpressure, so a human cannot click past it either. It is checked BEFORE the
 * execution row is created, so a quota refusal no longer materialises as a `failed`
 * run that every scheduler then retries as though it were transient.
 */
/**
 * Why a dispatch produced no run.
 *
 * `dispatchCloudRunForTask` used to answer a refusal with a bare `null`, and every
 * caller then had to GUESS which of its four refusals it had hit. The `/run-now`
 * route guessed `cloud_run_limit` and said so in the response — so a ticket refused
 * because its lifecycle-managed board wants a role-attributed run told the user, and
 * the agent driving it, that the workspace had run out of monthly cloud runs. A
 * remedy nobody could act on, for a problem nobody had.
 *
 * The reason therefore travels WITH the refusal, in the shared triage vocabulary the
 * lifecycle ledger and the board chip already resolve, plus the sentence a
 * non-UI caller should be shown ({@link AUTO_RUN_REASON_TEXT}, extended with the
 * specific detail the refusing guard knows).
 */
/**
 * `dispatch_error`: the dispatcher THREW before a run existed (a DB blip, an exception in
 * a guard, a runtime-submit failure). It is a refusal like the others — "no run, and here
 * is why" — rather than a swallowed exception, because a caller that `.catch`es it into a
 * bare `null` has to invent a reason, and the one it invented (`no_agent`) sent a person
 * to staff a lane that was staffed. See {@link dispatchError}.
 */
export type CloudDispatchRefusalReason = AutoRunReason | 'task_not_found' | 'dispatch_error';

/** The refusals a person directing a run may NOT override: they are billing entitlements,
 *  not backpressure, so a human click cannot clear them either. */
export const ENTITLEMENT_REFUSALS: ReadonlySet<CloudDispatchRefusalReason> = new Set<CloudDispatchRefusalReason>([
  'cloud_run_limit', 'tenant_token_limit',
]);

export interface CloudDispatchRefusal {
  reason: CloudDispatchRefusalReason;
  /** Actionable prose — rendered straight into an HTTP error body and an agent's tool error. */
  message: string;
}

/** The outcome of a cloud dispatch: an execution id, or WHY there is none. */
export interface CloudDispatchOutcome {
  executionId: number | null;
  /** Present exactly when `executionId` is null. */
  refusal?: CloudDispatchRefusal;
}

/** A refusal outcome, with the shared sentence for `reason` and any specific detail appended. */
function refuse(reason: CloudDispatchRefusalReason, detail?: string | null): CloudDispatchOutcome {
  const base = reason === 'task_not_found'
    ? 'No run: no ticket with that id exists in this workspace.'
    : reason === 'dispatch_error'
      ? 'No run: the dispatcher failed before a run could be created. The error above is the reason; it is not a configuration or entitlement problem.'
      : AUTO_RUN_REASON_TEXT[reason];
  return { executionId: null, refusal: { reason, message: detail?.trim() ? `${detail.trim()} ${base}` : base } };
}

/**
 * The outcome for a dispatcher that THREW. The one place a thrown error becomes a
 * refusal, so every caller that wraps `dispatchCloudRunForTask` in a `catch` hands the
 * real message on instead of a reasonless null.
 */
export function dispatchError(error: unknown): CloudDispatchOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return refuse('dispatch_error', message.slice(0, 400));
}

export async function dispatchCloudRunForTask(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  waitUntil: (p: Promise<unknown>) => void,
  params: {
    taskId: number; tenantId: number; payload?: string; submittedBy?: string;
    agentHostId?: number | null;
    /** HUMAN-initiated dispatch: skip the failure breaker + re-run cooldown (never
     *  the cloud-run cap). Autonomous callers must leave this unset. */
    force?: boolean;
    /**
     * A request-scoped memo of the ticket's execution rows (DISP-R1). Supplying it
     * saves ONE query on a path that just read the same list — the lane trigger,
     * which loads it in `evaluateTaskAutoRun` microseconds earlier.
     *
     * It carries ROWS, never a verdict. The breaker below still calls
     * `assessRerunBackoff` on them itself, so a caller can spare the dispatcher a
     * round trip but cannot talk it out of refusing. Handing in a precomputed
     * verdict is the one thing this deliberately does not allow: it would let a
     * dispatch path opt out of the breaker, which is the bug the choke point
     * exists to make impossible.
     */
    execMemo?: ExecutionReadMemo;
  },
): Promise<CloudDispatchOutcome> {
  const [taskRow] = await db
    .select({
      id: tasks.id, title: tasks.title, description: tasks.description,
      assignedAgentHostId: tasks.assignedAgentHostId, assignedAgentRef: tasks.assignedAgentRef,
      assignedUserId: tasks.assignedUserId,
      // The lane is part of an auto-run skip's STATE (see autoRunSkipLedger): the same
      // refusal on a different lane is a different fact about the ticket.
      status: tasks.status,
      priority: tasks.priority, projectId: tasks.projectId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, params.taskId), eq(projects.tenantId, params.tenantId)))
    .limit(1);
  if (!taskRow) return refuse('task_not_found');

  const submittedBy = params.submittedBy ?? 'system:autofix';

  // (0) MANAGED AUTHORIZATION — a REFUSAL, not an exception.
  //
  // This used to `throw`, and the throw was the whole failure mode: it happens BEFORE the
  // execution row exists, so nothing counted it. The lane trigger's catch recorded a raw
  // `auto_run_error` (unbounded — one row per sweep tick, on a database held under
  // $5/month), the failure breaker and the re-run cooldown never saw a failure to back
  // off from, and every other caller `.catch(() => null)`d it into silence. A managed
  // board therefore refused every autonomous dispatch forever, invisibly.
  //
  // It is the same KIND of answer as the two guards below — "this run must not start,
  // and here is why" — so it is recorded and returned the same way: through the
  // state-gated skip ledger, with a real `AutoRunReason` the lifecycle ledger can resolve.
  const authorization = await authorizeManagedTaskExecution(db, params.tenantId, params.taskId, params.payload);
  // A MANAGED board admitted a run that names no stage role, on a declared authority —
  // a person directing execution, or platform machinery. Two things are owed for that,
  // and both are owed HERE, at the one point that knows the board is managed AND that
  // this run carries no attribution (the caller knows neither):
  //
  //  1. The run is made LIFECYCLE-NEUTRAL. It executes and reports, but it may not move
  //     the lane or satisfy a manifest slot — so the sign-off gate it stepped around
  //     cannot also be stepped over, and the control the guard exists to enforce is
  //     exactly as intact after the override as before it.
  //  2. The override is RECORDED against the ticket, naming who authorized it and why.
  //     An override nobody can see afterwards is indistinguishable from a hole.
  let payload = params.payload;
  if (authorization.allowed && authorization.authority) {
    payload = markLifecycleNeutral(payload);
    await recordCloudToolEvent(db, {
      tenantId:      params.tenantId,
      cloudAgentRef: taskRow.assignedAgentRef ?? submittedBy,
      executionId:   null,
      sessionKey:    `task:${params.taskId}`,
      toolName:      MANAGED_OVERRIDE_EVENT,
      category:      'planning',
      detail:        { taskId: params.taskId, lane: taskRow.status, authority: authorization.authority, submittedBy },
      result:        `Managed-board gate overridden by ${describeAuthority(authorization.authority)}. The run cannot advance the lane or satisfy a sign-off slot.`.slice(0, 300),
    }).catch((error) => {
      // The run is authorized either way — telemetry must never block it. But an
      // override whose audit row failed to write is exactly the case an operator needs
      // to hear about, so it is REPORTED rather than swallowed.
      reportCaughtError(error, { source: 'application/runtime/dispatchCloudRun.ts', operation: 'managed_gate_override_audit', context: { logMessage: '[managed-override] audit row failed to write', details: { tenantId: params.tenantId, taskId: params.taskId } } });
    });
  }
  if (!authorization.allowed) {
    await recordAutoRunSkip(env, db, {
      tenantId: params.tenantId,
      taskId: params.taskId,
      cloudAgentRef: taskRow.assignedAgentRef ?? submittedBy,
      lane: taskRow.status,
      reason: 'managed_no_role' satisfies AutoRunReason,
      detail: {
        taskId: params.taskId, reason: 'managed_no_role' satisfies AutoRunReason,
        managed: authorization.managed, refusal: authorization.reason ?? null, submittedBy,
      },
      result: `Dispatch refused: ${authorization.reason ?? 'managed execution is not authorized'}`,
    });
    return refuse('managed_no_role', authorization.reason);
  }

  // (1) CLOUD-RUN CAP — checked before the execution row exists. A quota refusal is
  // not a run that failed; it is a run that must not start, and it cannot clear by
  // retrying (only a new billing month or an upgrade clears it). Creating a `failed`
  // execution for it is what made every scheduler treat it as a transient blip and
  // retry it on the next tick. Refuse, record WHY against the ticket, create nothing.
  //
  // ONLY for a cloud-bound dispatch. On-prem runs execute on the user's own machine
  // and are unlimited by policy (it is what the refusal message itself promises), so
  // a task with a pinned host skips the pre-flight entirely. Delivery to that host can
  // still fail and fall through to cloud — which is why the gate inside
  // `startDispatchedExecution` stays, and why `cloudGate` is only handed down when it
  // was actually resolved here.
  const hostPinned = (params.agentHostId ?? taskRow.assignedAgentHostId) != null;
  const cloudGate = hostPinned ? undefined : await enforceCloudRunCap(db, params.tenantId, env);
  if (cloudGate && !cloudGate.allowed) {
    await recordAutoRunSkip(env, db, {
      tenantId: params.tenantId,
      taskId: params.taskId,
      cloudAgentRef: taskRow.assignedAgentRef ?? submittedBy,
      lane: taskRow.status,
      reason: 'cloud_run_limit',
      // `reason` must be a real AutoRunReason: the lifecycle ledger reads this blob to
      // resolve the ticket's stall reason, and an off-vocabulary value would resolve to
      // no explanation at all — the silent-gap failure mode this whole pass removes.
      detail: {
        taskId: params.taskId, reason: 'cloud_run_limit' satisfies AutoRunReason, retryable: false,
        used: cloudGate.used, limit: cloudGate.limit, plan: cloudGate.effectivePlan, submittedBy,
      },
      result: `Dispatch refused: monthly cloud-run allowance reached (${cloudGate.used}/${cloudGate.limit} on the ${cloudGate.effectivePlan} plan). Retrying will not clear this — upgrade at builderforce.ai/pricing. On-prem and VS Code runs stay unlimited.`,
    });
    return refuse('cloud_run_limit', `${cloudGate.used}/${cloudGate.limit} runs used on the ${cloudGate.effectivePlan} plan.`);
  }

  // (2) FAILURE BREAKER + RE-RUN COOLDOWN — the same verdict `evaluateTaskAutoRun`
  // shows in triage, applied to EVERY autonomous dispatcher rather than only the lane
  // trigger. A human dispatch (`force`) overrides, exactly as it always did.
  if (!params.force) {
    const backoff = assessRerunBackoff(
      // Same rows either way — the memo only decides whether they cost a query.
      params.execMemo
        ? await params.execMemo.listByTask(params.taskId)
        : (await runtimeService.listByTask(params.taskId)).map((e) => e.toPlain()),
      Date.now(),
    );
    if (backoff.blockedBy) {
      await recordAutoRunSkip(env, db, {
        tenantId: params.tenantId,
        taskId: params.taskId,
        cloudAgentRef: taskRow.assignedAgentRef ?? submittedBy,
        lane: taskRow.status,
        // The failure COUNT is part of the state: each additional failed run is a real
        // change (it is what walks the ticket toward the breaker), not a repeat.
        reason: `${backoff.blockedBy}:${backoff.consecutiveFailures}`,
        detail: {
          taskId: params.taskId, reason: backoff.blockedBy, submittedBy,
          consecutiveFailures: backoff.consecutiveFailures,
          ...(backoff.cooldownRemainingMs ? { cooldownRemainingMs: backoff.cooldownRemainingMs } : {}),
        },
        result: `Dispatch refused (${backoff.blockedBy}) for task ${params.taskId}: ${backoff.consecutiveFailures} consecutive failed runs. A human "Run now" overrides.`,
      });
      return refuse(backoff.blockedBy, `${backoff.consecutiveFailures} consecutive failed run(s).`);
    }
  }

  // A per-run pinned host (e.g. an approved high-priority on-prem run) overrides
  // the task's assignee for THIS dispatch so host targeting survives the replay.
  const effectiveTaskRow = (params.agentHostId != null
    ? { ...taskRow, assignedAgentHostId: params.agentHostId }
    : taskRow) as ExecutionTaskRow;

  const execution = await runtimeService.submit({
    taskId: params.taskId,
    agentHostId: effectiveTaskRow.assignedAgentHostId ?? undefined,
    tenantId: params.tenantId,
    submittedBy,
    // `payload`, not `params.payload`: an override was re-stamped above and the run must
    // carry the neutrality marker it was admitted under.
    payload,
  });
  // A run is starting — drop the skip-suppression marker so a stall AFTER this run is
  // recorded in full rather than swallowed as a repeat of the pre-run state.
  await clearAutoRunSkip(env, params.tenantId, params.taskId);
  // A resolved `cloudGate` is handed down so the choke point below does not re-run the
  // cap query — one check per dispatch, two places that can act on it. Omitted for a
  // host-pinned dispatch, so a host that fails delivery still gets capped down there.
  await startDispatchedExecution(
    env, db, runtimeService, waitUntil, params.tenantId,
    execution as SubmittedExecution, effectiveTaskRow, payload,
    cloudGate ? { cloudGate } : undefined,
  );
  return { executionId: execution.id };
}


/** The post-submit dispatch core, free of any request context. */
export async function startDispatchedExecution(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  waitUntil: (p: Promise<unknown>) => void,
  tenantId: number,
  execution: SubmittedExecution,
  taskRow: ExecutionTaskRow,
  payload: string | undefined,
  /** A cloud-run cap verdict the caller already resolved, so the pre-submit gate in
   *  {@link dispatchCloudRunForTask} and this one never query it twice. */
  opts?: { cloudGate?: CloudRunCapResult },
): Promise<unknown> {
  // On-Prem (hosted) execution happens ONLY when a host is explicitly pinned on the
  // task — a cloud agent is never broadcast to a client machine. Resolve a dispatch
  // target only for a pinned host (skips a needless all-online-hosts scan on the
  // common cloud-run path).
  const pinnedHostId = taskRow.assignedAgentHostId;
  const hostTargets = pinnedHostId != null ? await getDispatchTargets(db, tenantId, pinnedHostId) : [];

  // The executing cloud agent is whoever the caller pinned in the payload, else
  // the ticket's assigned agent (the swimlane's agent — `tasks.assignedAgentRef`).
  // Without this fallback an "Auto" run on a ticket assigned to a custom cloud
  // agent silently executed + was attributed as the gateway default, not the
  // assigned agent. Used for BOTH per-agent capability resolution (scope='agent')
  // and run attribution (engine/label/ref).
  //
  // An AUTO/DEFAULT run has neither — no payload pin, no assignee — and used to resolve
  // to `undefined`, which skipped every identity effect below: the ticket was never
  // claimed, `executions.cloud_agent_ref` stayed NULL, and the board could not say who
  // worked it. `resolveDefaultCloudAgentRef` gives that run the agent the workspace
  // would have assigned (the manager's own picker, then the role-capability oracle);
  // when nothing resolves it returns a TYPED reason, recorded below, so an anonymous
  // run says WHY it is anonymous instead of merely being anonymous.
  const pinnedAgentRef = parseCloudAgentRef(payload) ?? taskRow.assignedAgentRef ?? undefined;
  const defaultAgent = pinnedAgentRef
    ? null
    : await resolveDefaultCloudAgentRef(env, db, { tenantId, projectId: taskRow.projectId, taskId: taskRow.id });
  const cloudAgentRef = pinnedAgentRef ?? defaultAgent?.ref ?? undefined;

  // Run-time repo selection: a caller can pin which of the project's repos this run
  // (and its sticky finalize/CI/PRD) targets. Persist it on the task BEFORE we
  // resolve the repo below so resolveDefaultRepoForTask honors the pin; '' clears it
  // (Auto). Pin only a repo that actually belongs to this task's project — the
  // picker is project-scoped; this guards a stale/cross-project id.
  const repoIdSel = parseRepoId(payload);
  if (repoIdSel !== undefined) {
    const repoId = repoIdSel || null;
    const valid = repoId == null
      || (await db.select({ id: projectRepositories.id }).from(projectRepositories)
            .where(and(eq(projectRepositories.id, repoId), eq(projectRepositories.projectId, taskRow.projectId), eq(projectRepositories.tenantId, tenantId)))
            .limit(1)).length > 0;
    if (valid) {
      await db.update(tasks).set({ explicitRepoId: repoId, updatedAt: new Date() })
        .where(eq(tasks.id, taskRow.id)).catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "startDispatchedExecution", context: { logMessage: '[runtime-dispatch] task repo pin update failed', details: { tenantId, taskId: taskRow.id, error } } }));
    }
  }

  const [artifacts, agent, repoRef] = await Promise.all([
    resolveArtifacts(db, {
      tenantId,
      taskId: taskRow.id,
      agentHostId: taskRow.assignedAgentHostId ?? undefined,
      cloudAgentRef,
    }),
    resolveCloudAgent(env, tenantId, cloudAgentRef),
    resolveDefaultRepoForTask(db, tenantId, taskRow.id),
  ]);

  // Per-agent containment: `ide_agents.status != active` is the quarantine switch.
  // Refuse the named teammate without disturbing peers or the workspace-wide switch.
  if (agent.active === false) {
    const msg = `Agent "${agent.label ?? agent.ref ?? 'agent'}" is quarantined and cannot start executions. Re-enable it in Workforce before retrying.`;
    await runtimeService.update(execution.id, { status: ExecutionStatus.FAILED, errorMessage: msg });
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
      toolName: 'runtime.quarantined', category: 'governance',
      detail: { agentRef: agent.ref }, result: msg,
    });
    const updated = await runtimeService.getExecution(execution.id);
    notifyExecutionSubscribers(execution.id, {
      type: 'done', executionId: execution.id, status: updated.status,
      execution: updated.toPlain(), ts: new Date().toISOString(),
    });
    return updated.toPlain();
  }

  // The EXECUTING agent vs the ticket's OWNER are distinct roles. The swimlane's
  // agent works whatever stage (lane) the ticket is in — it executes AS itself
  // (resolved into `agent.ref` from the lane assignment / payload) and that run is
  // attributed to it via `executions.cloud_agent_ref`. But it must NOT seize
  // OWNERSHIP of the ticket: a ticket assigned to "bob" (an agent) during planning,
  // or to a human, stays assigned to them when a different lane agent runs a stage.
  // Self-assignment is therefore a CLAIM, only for a ticket that has no owner yet —
  // so the board shows who is working an otherwise-unowned ticket. Previously this
  // unconditionally overwrote `tasks.assignedAgentRef` with the executing agent,
  // clobbering the planned assignee every time a lane agent picked the ticket up.
  if (agent.ref) {
    const unowned = !taskRow.assignedAgentRef && taskRow.assignedAgentHostId == null && !taskRow.assignedUserId;
    await Promise.all([
      unowned
        ? db.update(tasks).set({ assignedAgentRef: agent.ref, updatedAt: new Date() })
            .where(eq(tasks.id, taskRow.id)).catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "startDispatchedExecution", context: { logMessage: '[runtime-dispatch] unowned task claim failed', details: { tenantId, taskId: taskRow.id, agentRef: agent.ref, error } } }))
        : Promise.resolve(),
      // Always stamp the EXECUTION with the agent that ran it, so its logs/telemetry
      // stay scoped to THIS run even when ownership stays with someone else.
      db.update(executions).set({ cloudAgentRef: agent.ref })
        .where(eq(executions.id, execution.id)).catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "startDispatchedExecution", context: { logMessage: '[runtime-dispatch] execution attribution update failed', details: { tenantId, executionId: execution.id, agentRef: agent.ref, error } } })),
    ]);
  } else if (defaultAgent && defaultAgent.ref == null) {
    // NOBODY could be resolved. The run still executes — refusing it would strand a
    // ticket over a roster gap — but it must not do so silently: an unattributed run is
    // indistinguishable from a lost one on the board, which is the failure mode this
    // whole resolution exists to end. Record the typed reason on the run's own timeline
    // so "who worked this ticket?" has an answer even when the answer is "nobody could
    // be named, and here is why".
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef: undefined, executionId: execution.id,
      toolName: 'runtime.identity', category: 'governance',
      detail: { reason: defaultAgent.reason, roleKey: defaultAgent.roleKey, taskId: taskRow.id },
      result: UNATTRIBUTED_RUN_MESSAGE[defaultAgent.reason],
    }).catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "startDispatchedExecution", context: { logMessage: '[runtime-dispatch] unattributed-run reason telemetry failed', details: { tenantId, executionId: execution.id, reason: defaultAgent.reason, error } } }));
  }

  // Fold the agent's own model into the payload up front so EVERY surface — the
  // on-prem host included — runs AS the agent's model, never silently the gateway
  // default. (The cloud branch reuses this same effective payload below.)
  //
  // Project Evermind consumer emitter (single point, all surfaces). When the agent
  // has NO explicit base model AND the project is configured to run on its own
  // self-learning model, default to the project's CURRENT Evermind head (a concrete
  // `evermind/<ref>`, resolved ONCE here — the run boundary → pull-on-boundary). Every
  // surface then agrees: the cloud loop hard-pins the `evermind/` route, on-prem sends
  // it to the gateway (which routes it to the evermind vendor). Precedence:
  // payload pin > agent.baseModel > project Evermind > gateway default. Off/unseeded →
  // undefined → today's behaviour. [[evermind-learning-architecture]]
  //
  // The pin is emitted unconditionally now that Evermind tool-calls (constrained
  // decoding — see application/llm/evermindToolCall). This used to be gated on
  // `modelSupportsTools`, withholding the pin entirely because a tool-less head
  // handed `tools` narrates the calls it cannot emit and does zero work. That
  // failure mode is gone at the source, and the remaining risk — a head that CAN
  // form a call but picks one at random — is caught per-request by the vendor's
  // confidence gate, which 400s so the run's SOFT pin cascades to a coding model.
  // Deciding it there (with the actual margin in hand) beats deciding it here on a
  // static flag that could only ever say "never".
  const projectEvermindPin = agent.baseModel
    ? undefined
    : await resolveProjectInferenceModel(env as Env, db, tenantId, taskRow.projectId);
  const effectivePayload = withDefaultModel(payload, agent.baseModel ?? projectEvermindPin);

  const message: DispatchMessage = {
    type: 'task.assign',
    executionId: execution.id,
    taskId: taskRow.id,
    payload: effectivePayload,
    engine: agent.engine,
    agentLabel: agent.label,
    repo: repoRef ? { repoId: repoRef.repoId, defaultBranch: repoRef.defaultBranch } : undefined,
    task: { title: taskRow.title, description: taskRow.description },
    artifacts,
  };

  // ONE agent engine (the V2 Agent) runs on three interchangeable long-lived
  // surfaces — see agent taxonomy ([[agent-types-taxonomy]]):
  //   • Durable Object (CloudRunnerDO)         — cloud, on-demand serverless.
  //   • Container (long-lived Cloudflare)      — cloud, persistent process + shell.
  //   • On-Prem machine                        — the client's machine, reached via
  //     the AGENT_HOST_RELAY. It is ALSO a long-lived runtime (equivalent to a
  //     container) and runs the SAME V2 Agent (Claude-Agent-SDK) the cloud surfaces
  //     do, so a V2 agent pinned to a host executes ON the machine — no engine fork.
  const surface = resolveCloudSurface(agent.runtimeSurface, pinnedHostId != null);
  const typeLabel = cloudAgentTypeLabel(surface);

  // Dispatch to an On-Prem host when one is explicitly pinned AND the agent's
  // declared `runtime_support` permits host execution (an agent marked cloud-only
  // is never delivered to a pinned host — it falls through to the cloud executor).
  // The engine no longer gates this: the on-prem host runtime runs the V2 Agent
  // natively, so V2 IS delivered to the machine (the surface is just where the one
  // engine runs). preferred_runtime (for runtime_support==='both') is resolved on
  // the swimlane path; here a host run still requires an explicit pin, so it cannot
  // route AWAY from a pinned host.
  const hostAllowed = agentAllowsHostExecution(agent.runtimeSupport);
  if (pinnedHostId != null && !hostAllowed) {
    await recordCloudToolEvent(db, {
      tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
      toolName: 'runtime.route', category: 'planning',
      detail: { reason: 'agent runtime_support=cloud; pinned host ignored', pinnedHostId, ranOn: 'cloud' },
      result: `Agent "${agent.label ?? agent.ref ?? 'cloud agent'}" is cloud-only (runtime_support=cloud); the pinned On-Prem host was not used — running in the cloud.`,
    }).catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "startDispatchedExecution", context: { logMessage: '[runtime-dispatch] route telemetry failed', details: { tenantId, executionId: execution.id, error } } }));
  }
  const delivered = pinnedHostId != null && hostAllowed
    ? (await Promise.all(hostTargets.map((targetId) => dispatchToAgentHost(env as DispatchEnv, targetId, message).catch(() => false)))).some(Boolean)
    : false;

  const notifyDone = async () => {
    const updated = await runtimeService.getExecution(execution.id);
    notifyExecutionSubscribers(execution.id, {
      type: 'done',
      executionId: execution.id,
      status: updated.status,
      execution: updated.toPlain(),
      ts: new Date().toISOString(),
    });
  };

  if (!delivered) {
    // Cloud-compute gate: a cloud run executes on OUR infra (unlike on-prem/VSIX),
    // so it consumes the monthly "Cloud runs" allowance even when the tenant brings
    // their own model (BYO tokens are $0 to us, but the orchestration isn't). This
    // is the ONE choke point every cloud entry funnels through (Run-now, board,
    // autofix), so gating here covers them all. Over the cap → fail fast with an
    // upgrade hint rather than start a run we'd have to run for free. Superadmin /
    // unlimited plans pass; a metering error fails OPEN (never blocks a real run).
    //
    // An AUTONOMOUS dispatch never reaches this branch: `dispatchCloudRunForTask`
    // already refused before creating a run (and passes its verdict down via `opts`
    // so the query is not repeated). What lands here is an HTTP submit, where the
    // person who clicked deserves a visible failed run carrying the reason.
    const cloudGate = opts?.cloudGate ?? await enforceCloudRunCap(db, tenantId, env);
    if (!cloudGate.allowed) {
      const msg = `Monthly cloud-run allowance reached (${cloudGate.used}/${cloudGate.limit} on the ${cloudGate.effectivePlan} plan). Upgrade at builderforce.ai/pricing to run more cloud agents — on-prem and VS Code runs stay unlimited.`;
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
        toolName: 'runtime.route', category: 'planning',
        detail: { reason: 'cloud_run_limit_exceeded', used: cloudGate.used, limit: cloudGate.limit, plan: cloudGate.effectivePlan },
        result: msg,
      }).catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "startDispatchedExecution", context: { logMessage: '[runtime-dispatch] cloud-cap telemetry failed', details: { tenantId, executionId: execution.id, error } } }));
      await runtimeService.update(execution.id, { status: ExecutionStatus.FAILED, errorMessage: msg }).catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "startDispatchedExecution", level: 'warning', context: { logMessage: '[runtime-dispatch] cloud-cap terminal transition rejected', details: { tenantId, executionId: execution.id, error } } }));
      await notifyDone();
      return runtimeService.getExecution(execution.id).then((e) => e.toPlain()).catch(() => ({ id: execution.id, status: ExecutionStatus.FAILED }));
    }

    // Route a container-surface run to the REAL long-lived Cloudflare Container
    // (AgentContainerDO) when it's bound; everything else — a durable-surface run,
    // and a container run with no Container binding — runs on the durable executor
    // (CloudRunnerDO). The run carries its OWN model so it is never silently
    // attributed to the gateway default. (One engine: the V2 Agent; V1 is deleted.)
    const wantsContainer = surface === 'container';
    const hasContainerBinding = wantsContainer && !!env.AGENT_CONTAINER;
    const hasCloudRunner = !!env.CLOUD_RUNNER;
    // The GitHub Actions surface has no binding and no liveness probe — a runner
    // does not exist until GitHub schedules one — so the pre-flight is "can this
    // be QUEUED": a linked GitHub repo whose default branch carries the agent
    // workflow. Resolved inside orchestrate() because it costs a GitHub call.
    const wantsGithubActions = surface === 'github_actions';

    // The payload the run is dispatched with. Once `orchestrate` resolves the executor
    // it re-stamps this (and the executions row) with `executor` so the orphan reaper /
    // read-path repair pick the right per-surface silence ceiling. The kickoff closures
    // read this variable (not `effectivePayload`) so they carry the stamped copy.
    let dispatchPayload = effectivePayload;

    const failCloudRuntimeUnavailable = async (reason: string) => {
      const msg = `Cloud execution could not start because no durable executor was available: ${reason}. `
        + 'The unsafe in-request Worker fallback was not started because multi-step runs exceed its background-execution limit. '
        + 'Verify the CLOUD_RUNNER Durable Object binding and deployment, then re-run the task.';
      await runtimeService.update(execution.id, {
        status: ExecutionStatus.FAILED,
        errorMessage: msg,
      }).catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "failCloudRuntimeUnavailable", level: 'warning', context: { logMessage: '[runtime-dispatch] unavailable-runtime terminal transition rejected', details: { tenantId, executionId: execution.id, error } } }));
      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
        toolName: 'run.failed', category: 'error',
        detail: { reason, phase: 'durable_kickoff' },
        result: msg,
      }).catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "failCloudRuntimeUnavailable", context: { logMessage: '[runtime-dispatch] unavailable-runtime telemetry failed', details: { tenantId, executionId: execution.id, error } } }));
      await notifyDone().catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "failCloudRuntimeUnavailable", context: { logMessage: '[runtime-dispatch] unavailable-runtime live notification failed', details: { tenantId, executionId: execution.id, error } } }));
    };
    /**
     * Queue the run onto the repo's GitHub Actions runners.
     *
     * Unlike the other two starters this hands off to infrastructure we do not
     * control and cannot call back into: `workflow_dispatch` returns 204 meaning
     * "accepted into GitHub's queue", not "a runner started". The run becomes
     * real only when the runner's first heartbeat reaches
     * /api/runtime/github-actions/op — which is why this surface carries a much
     * larger orphan-reaper ceiling (CLOUD_GITHUB_ACTIONS_SILENCE_MS).
     *
     * A dispatch that GitHub rejects IS terminal, though: nothing was queued, so
     * no runner will ever call back and the run would otherwise sit pending until
     * reaped ~20 minutes later with a misleading "silent run" reason.
     */
    const startGithubActions = async () => {
      const res = await dispatchGithubActionsRun(env, db, {
        tenantId, taskId: taskRow.id, executionId: execution.id,
      }).catch((e) => ({ ok: false as const, code: 'threw', reason: e instanceof Error ? e.message : String(e) }));

      if (!res.ok) {
        await failCloudRuntimeUnavailable(`GitHub Actions dispatch failed: ${res.reason}`);
        return;
      }

      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
        toolName: 'runtime.queued', category: 'planning',
        detail: { surface: 'github_actions' },
        result: 'Queued on GitHub Actions — waiting for a runner to be scheduled.',
      }).catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "startGithubActions", context: { logMessage: '[runtime-dispatch] GitHub Actions dispatch telemetry failed', details: { tenantId, executionId: execution.id, error } } }));
    };

    const startDurable = async () => {
      const cloudRunner = env.CLOUD_RUNNER;
      if (!cloudRunner) {
        await failCloudRuntimeUnavailable('the CLOUD_RUNNER binding is not configured');
        return;
      }
      try {
        const stub = cloudRunner.get(cloudRunner.idFromName(`exec:${execution.id}`));
        const res = await stub.fetch('https://cloud-runner/start', {
          method: 'POST',
          body: JSON.stringify({
            executionId: execution.id, tenantId, projectId: taskRow.projectId,
            taskId: taskRow.id, taskTitle: taskRow.title, taskDescription: taskRow.description,
            cloudAgentRef: agent.ref, agentLabel: agent.label ?? 'BuilderForce Agent',
            payload: dispatchPayload, artifacts,
          }),
        });
        if (!res.ok) {
          await failCloudRuntimeUnavailable(`CloudRunnerDO /start returned HTTP ${res.status}`);
        }
      } catch (e) {
        await failCloudRuntimeUnavailable(`CloudRunnerDO /start threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    // Start the run in a real long-lived Cloudflare Container: prep the prompts
    // (shell-capable variant), mint the per-run callback token, hand the container a
    // tokened clone URL for its local workspace, and POST /run. The container drives
    // the loop in its own process and calls back into /internal/container-op. Any
    // failure to reach the container degrades to the durable executor.
    // Container executor — the caller (orchestrate) has already proved the container
    // is live via chooseCloudExecutor's health gate, so this just starts the run.
    // Any kickoff failure still degrades to the durable executor.
    const startContainer = async (stub: ContainerRunTarget) => {
      // The kickoff itself (prompts, run token, clone URL, step budget) lives in the
      // shared launcher, so the RESUME path relaunches a paused container with a
      // byte-identical world. This route keeps only what is dispatch-specific: the
      // degrade-to-durable fallback and the "it started" transition.
      const launched = await launchContainerRun(env, db, stub, {
        tenantId,
        executionId: execution.id,
        taskRow: { id: taskRow.id, title: taskRow.title, description: taskRow.description, projectId: taskRow.projectId },
        agentLabel: agent.label ?? 'BuilderForce Agent',
        model: agent.baseModel,
        cloudAgentRef: agent.ref,
        artifacts,
        payload: dispatchPayload,
      });
      if (!launched.ok) {
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
          toolName: 'runtime.fallback', category: 'planning',
          detail: { reason: launched.reason, ranOn: 'durable' },
          result: `Cloudflare Container kickoff failed (${launched.reason}) — running on the durable executor instead.`,
        });
        await startDurable();
        return;
      }
      // The container accepted the run and now drives the loop via callbacks to
      // /internal/container-op, which only flips the row at finalize. Without this
      // the execution would read PENDING for the whole live run. Mark it RUNNING
      // now — parity with the durable (CloudRunnerDO.start) and Worker
      // (runCloudExecution) executors, which both transition at kickoff.
      await markCloudExecutionRunning(runtimeService, execution.id);
    };

    // Decide the executor INSIDE waitUntil: the container health probe is async and
    // must not block the submit response. The decision, the why-not-container note,
    // and the dispatch telemetry all reflect where the run ACTUALLY lands — not a
    // 202 that masks a dead container.
    const orchestrate = async () => {
      const stub = hasContainerBinding && env.AGENT_CONTAINER
        ? env.AGENT_CONTAINER.get(env.AGENT_CONTAINER.idFromName(`exec:${execution.id}`))
        : null;
      const containerHealthy = stub ? await probeContainerHealth(stub) : false;
      const actionsAvailable = wantsGithubActions
        ? await resolveDefaultRepoForTask(db, tenantId, taskRow.id)
            .then((r) => (r ? githubActionsAvailable(env, db, tenantId, r.repoId) : false))
            .catch(() => false)
        : false;
      const executor = chooseCloudExecutor({
        wantsContainer, hasContainerBinding, containerHealthy, hasCloudRunner,
        wantsGithubActions, githubActionsAvailable: actionsAvailable,
      });

      // Stamp the resolved executor onto the payload + the executions row so the orphan
      // reaper and read-path repair measure this run against the RIGHT silence ceiling:
      // a long-lived 'durable'/'container' run heartbeats once per alarm tick and a tick
      // spans one slow LLM step, so it must not be reaped at the serverless 90s wall
      // (execution #136). The row is what the reaper reads; the kickoff body carries the
      // same stamped copy so a self-heal re-dispatch keeps it.
      dispatchPayload = executor === 'unavailable'
        ? effectivePayload
        : withExecutor(effectivePayload, executor);
      await db.update(executions).set({ payload: dispatchPayload })
        .where(eq(executions.id, execution.id)).catch((error) => reportCaughtError(error, { source: "application/runtime/dispatchCloudRun.ts", operation: "orchestrate", context: { logMessage: '[runtime-dispatch] executor payload stamp failed', details: { tenantId, executionId: execution.id, executor, error } } }));

      await recordCloudToolEvent(db, {
        tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
        toolName: 'runtime.dispatch', category: 'planning',
        detail: { agentType: typeLabel, engine: agent.engine, surface, model: agent.baseModel ?? 'gateway-default', executor },
        result: `Dispatching ${typeLabel} to the ${executor} cloud executor (model: ${agent.baseModel ?? 'gateway default'}).`,
      });

      // Explain a container→durable/worker downgrade so the timeline shows WHY.
      if (wantsContainer && executor !== 'container') {
        const why = !hasContainerBinding ? 'no long-lived Cloudflare Container is bound' : 'the Cloudflare Container is not live (health probe failed)';
        const fallbackResult = executor === 'unavailable'
          ? `${typeLabel}: ${why}, and no durable executor is available — failing without starting the unsafe in-request Worker loop.`
          : `${typeLabel}: ${why} — running on the durable cloud executor instead, which executes the run to completion.`;
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
          toolName: 'runtime.fallback', category: 'planning',
          detail: { requestedSurface: 'container', ranOn: executor, reason: !hasContainerBinding ? 'no AGENT_CONTAINER binding' : 'container /health unreachable' },
          result: fallbackResult,
        });
      }

      // Explain a github_actions→durable downgrade the same way the container
      // downgrade is explained, so the timeline says WHY rather than silently
      // running somewhere the tenant did not choose.
      if (wantsGithubActions && executor !== 'github_actions') {
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
          toolName: 'runtime.fallback', category: 'planning',
          detail: { requestedSurface: 'github_actions', ranOn: executor, reason: 'agent workflow not available on the linked repo' },
          result: `${typeLabel}: the GitHub Actions agent workflow is not present on the linked repo — running on the ${executor} executor instead.`,
        });
      }

      if (executor === 'github_actions') await startGithubActions();
      else if (executor === 'container' && stub) await startContainer(stub);
      else if (executor === 'durable') await startDurable();
      else await failCloudRuntimeUnavailable('the CLOUD_RUNNER binding is not configured');
    };
    // orchestrate() degrades container→durable and fails fast when durable kickoff is
    // unavailable. It never runs the multi-step loop inside waitUntil: that path is
    // subject to the background-execution wall that caused the original timeouts.
    // Catch any unexpected orchestration failure so the row is never stranded pending.
    waitUntil(orchestrate().catch(async (err) => {
      try {
        const current = await runtimeService.getExecution(execution.id);
        if (isTerminalExecutionStatus(current.status)) return;
        const msg = `Cloud dispatch failed before any executor took the run: ${err instanceof Error ? err.message : String(err)}`;
        await runtimeService.update(execution.id, { status: ExecutionStatus.FAILED, errorMessage: msg }).catch((transitionError) => reportCaughtError(transitionError, { source: "application/runtime/dispatchCloudRun.ts", operation: "startDispatchedExecution", level: 'warning', context: { logMessage: '[runtime-dispatch] orchestration failure transition rejected', details: { tenantId, executionId: execution.id, transitionError } } }));
        await recordCloudToolEvent(db, {
          tenantId, cloudAgentRef: agent.ref, executionId: execution.id,
          toolName: 'run.failed', category: 'error',
          detail: { reason: err instanceof Error ? err.message : String(err), phase: 'dispatch' },
          result: msg,
        });
        await notifyDone();
      } catch (recoveryError) {
        reportCaughtError(recoveryError, { source: "application/runtime/dispatchCloudRun.ts", operation: "startDispatchedExecution", context: { logMessage: '[runtime-dispatch] orchestration recovery failed; stale reaper is the backstop', details: {
          tenantId,
          executionId: execution.id,
          recoveryError,
        } } });
      }
    }));
  }

  // Announce the queued/dispatched execution immediately.
  notifyExecutionSubscribers(execution.id, {
    type: 'status_change',
    executionId: execution.id,
    status: execution.status,
    execution: execution.toPlain(),
    ts: new Date().toISOString(),
  });

  return execution.toPlain();
}

export async function getDispatchTargets(db: Db, tenantId: number, assignedAgentHostId?: number | null): Promise<number[]> {
  if (assignedAgentHostId != null) {
    const [row] = await db
      .select({ id: agentHosts.id })
      .from(agentHosts)
      .where(
        and(
          eq(agentHosts.id, assignedAgentHostId),
          eq(agentHosts.tenantId, tenantId),
        ),
      );
    return row ? [row.id] : [];
  }

  const rows = await db
    .select({ id: agentHosts.id })
    .from(agentHosts)
    .where(
      and(
        eq(agentHosts.tenantId, tenantId),
        agentHostOnlineCondition(),
      ),
    );
  return rows.map((row) => row.id);
}
