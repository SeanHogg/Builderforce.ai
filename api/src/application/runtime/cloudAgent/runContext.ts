/**
 * What a resumed image run needs to know about ITSELF, and the two liveness
 * signals every image op depends on.
 *
 * Split out of `cloudAgentEngine.ts` alongside `agent.ts`, `routing.ts` and
 * `prd.ts` — see `agent.ts` for why the 4,117-line original was broken up.
 *
 * ── WHY THIS IS A SEPARATE CONCERN ──────────────────────────────────────────
 * A Cloudflare Container and a GitHub Actions runner hold no database
 * credentials, so every op they post arrives with an execution id and nothing
 * else. {@link loadContainerRunContext} is what turns that id back into a run:
 * the ticket, the project, the executing agent, the model it was routed to and
 * the plan that funded it. It is read on EVERY op of a long run, which is why it
 * is cached — and why {@link invalidateContainerRunContexts} exists, because a
 * plan change mid-run must not be served from a ten-minute-old snapshot.
 *
 * {@link isExecutionCancelled} and {@link heartbeatExecution} live here because
 * they are the same question from two directions — is this run still alive, and
 * is it still allowed to be — and every op asks one or both.
 */
import { and, eq } from 'drizzle-orm';
import { loadCapabilityContext } from '../../artifact/capabilityContext';
import { resolveArtifacts } from '../../artifact/resolveArtifacts';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { findCanonicalBoard } from '../../swimlane/canonicalBoard';
import { parseCloudAgentRef, parseModel, parseOriginatingChatId } from '../cloudDispatch';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../../infrastructure/cache/readThroughCache';
import { executions, tasks } from '../../../infrastructure/database/schema';
import { loadAgentPsychometric, resolveCloudAgent } from './agent';
import { resolveCloudRouting } from './routing';
import type { EffectivePlan } from '../../llm/LlmProxyService';
import type { AgentExecParams } from '@builderforce/agent-tools';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';

/** The run identity an image op is answered against: the ticket it is working, the
 *  project it belongs to, the agent it executes as, the model it was routed to and
 *  the plan that funds it. Rebuilt from an execution id on every op, because the
 *  image itself holds no credentials and no state the Worker can trust. */
export interface ContainerRunContext {
  tenantId: number;
  taskId: number;
  projectId: number;
  taskTitle: string;
  taskDescription: string | null;
  cloudAgentRef?: string;
  agentLabel: string;
  model?: string;
  /** Brain chat that launched this run; authoritatively parsed from the execution payload. */
  originatingChatId?: number;
  /** The tenant's LLM routing, resolved once at context build (and cached with it)
   *  so per-op `llm` calls pick the plan's pool/key without a per-call plan query. */
  effectivePlan: EffectivePlan;
  premiumOverride: boolean;
  /** Whether a PREMIUM (any-paid-OpenRouter) pin may be honoured — paid plan + a
   *  validated card. Resolved with the routing above so the container op enforces the
   *  same rule as the durable loop. */
  premiumEntitled: boolean;
  /** Did a platform superadmin submit this run? See {@link CloudRouting.isSuperadmin}. */
  isSuperadmin: boolean;
  /** Execution levers compiled from the assigned personas + the agent's own
   *  personality, resolved once at context build (cached) so the container's per-step
   *  `llm` op applies the trait-derived temperature — parity with the Worker/DO loop. */
  execParams: AgentExecParams;
}

/**
 * The per-tenant version token stamped into every container-run-context cache key.
 *
 * The context caches `premiumEntitled` for ten minutes, which meant a tenant who had
 * just validated a card still could not run premium on the container surface until
 * that window expired — a paywall that stayed closed after the customer paid. The key
 * is per EXECUTION, so a `card.validated` webhook cannot enumerate the entries to
 * drop; bumping this token orphans all of them in one write, which is exactly the
 * enumeration KV cannot do. Orphans age out on their own TTL.
 */
export function containerContextVersionKey(tenantId: number): string {
  return `containerctx-ver:${tenantId}`;
}

/**
 * Invalidate every cached container-run context for one tenant.
 *
 * Called when something changes the tenant's ENTITLEMENT rather than the run — today
 * a card validation. Best-effort by contract: a missed bump costs at most the
 * remainder of the ten-minute window, whereas failing the webhook would retry a
 * validation that already landed.
 */
export async function invalidateContainerRunContexts(env: Env, tenantId: number): Promise<void> {
  await bumpCacheVersion(env, containerContextVersionKey(tenantId)).catch((error) => {
    reportCaughtError(error, { source: 'application/runtime/cloudAgentEngine.ts', operation: 'invalidateContainerRunContexts' });
  });
}

/** Load (and briefly cache) the container-run context for an execution. No secret
 *  is in this object, so it is safe to cache in the shared read-through cache.
 *
 *  The key carries a per-tenant version token so an entitlement change (a validated
 *  card) can drop every entry at once — see {@link invalidateContainerRunContexts}.
 *  Resolving the tenant costs one extra read, itself cached for a day because an
 *  execution's tenant is immutable. */
export async function loadContainerRunContext(env: Env, db: Db, executionId: number): Promise<ContainerRunContext | null> {
  const tenantId = await getOrSetCached(
    env,
    `exec-tenant:${executionId}`,
    async () => {
      const [row] = await db.select({ tenantId: executions.tenantId })
        .from(executions).where(eq(executions.id, executionId)).limit(1);
      return row?.tenantId ?? null;
    },
    { kvTtlSeconds: 86_400 },
  ).catch(() => null);
  if (tenantId == null) return null;
  const version = await getCacheVersion(env, containerContextVersionKey(tenantId)).catch(() => 'v0');

  return getOrSetCached(env, `containerctx:${version}:${executionId}`, async () => {
    const [exec] = await db
      .select({ taskId: executions.taskId, tenantId: executions.tenantId, payload: executions.payload, submittedBy: executions.submittedBy })
      .from(executions).where(eq(executions.id, executionId)).limit(1);
    if (!exec) return null;
    const [task] = await db
      .select({ title: tasks.title, description: tasks.description, projectId: tasks.projectId, assignedAgentRef: tasks.assignedAgentRef })
      .from(tasks).where(eq(tasks.id, exec.taskId)).limit(1);
    if (!task) return null;
    const explicitRef = parseCloudAgentRef(exec.payload ?? undefined);
    const board = await findCanonicalBoard(db, task.projectId, exec.tenantId);
    // Managed-ticket assignees coordinate; role dispatches must name their executor.
    if (board?.lifecycleManaged && !explicitRef) return null;
    const ref = explicitRef ?? task.assignedAgentRef ?? undefined;
    const agent = await resolveCloudAgent(env, exec.tenantId, ref);
    if (agent.active === false) return null;
    const payloadModel = parseModel(exec.payload ?? undefined);
    const originatingChatId = parseOriginatingChatId(exec.payload);
    const routing = await resolveCloudRouting(env, exec.tenantId, exec.submittedBy);
    // Compile the persona/agent personality exec levers ONCE per run (cache-backed
    // persona bodies), so the container's per-step `llm` op applies the same
    // trait-derived temperature the Worker/DO loops do. Best-effort: a resolution
    // failure must NOT break the container run — degrade to no exec overrides.
    let execParams: AgentExecParams = {};
    try {
      const [artifacts, agentPsychometric] = await Promise.all([
        resolveArtifacts(db, { tenantId: exec.tenantId, taskId: exec.taskId, projectId: task.projectId, cloudAgentRef: agent.ref }),
        loadAgentPsychometric(env, exec.tenantId, agent.ref),
      ]);
      execParams = (await loadCapabilityContext(env, db, artifacts, agentPsychometric)).execParams;
    } catch (error) {
      reportCaughtError(error, { source: "application/runtime/cloudAgent/runContext.ts", operation: "loadContainerRunContext", context: { logMessage: '[cloud-container] execution personality context load failed', details: {
        tenantId: exec.tenantId,
        executionId,
        taskId: exec.taskId,
        error,
      } } });
    }
    return {
      tenantId: exec.tenantId, taskId: exec.taskId, projectId: task.projectId,
      taskTitle: task.title, taskDescription: task.description,
      cloudAgentRef: agent.ref, agentLabel: agent.label ?? 'BuilderForce Agent',
      model: payloadModel ?? agent.baseModel,
      ...(originatingChatId != null ? { originatingChatId } : {}),
      effectivePlan: routing.effectivePlan, premiumOverride: routing.premiumOverride,
      premiumEntitled: routing.premiumEntitled,
      isSuperadmin: routing.isSuperadmin,
      execParams,
    };
  }, { kvTtlSeconds: 600, l1TtlMs: 600_000 });
}

/** True when the execution has been flipped to CANCELLED from another isolate. */
export async function isExecutionCancelled(db: Db, executionId: number): Promise<boolean> {
  try {
    const [row] = await db.select({ status: executions.status }).from(executions).where(eq(executions.id, executionId)).limit(1);
    return row?.status === 'cancelled';
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cloudAgent/runContext.ts", operation: "isExecutionCancelled", context: { logMessage: '[cloud-run] cancellation status check failed', details: { executionId, error } } });
    return false;
  }
}

/**
 * Bump `executions.updated_at` — the cloud-run liveness heartbeat the orphan reaper
 * measures "last activity" from. A container can spend minutes inside a single
 * `run_command` (a build/test step) with no LLM round-trip, so it pings this on a
 * timer independent of LLM steps; without that the reaper would kill a healthy,
 * busy container mid-build. ONE writer, so the `llm` op and the dedicated
 * `heartbeat` op agree. Best-effort — a missed beat is covered by the next one.
 */
export async function heartbeatExecution(db: Db, executionId: number): Promise<void> {
  await db.update(executions).set({ updatedAt: new Date() }).where(eq(executions.id, executionId))
    .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgent/runContext.ts", operation: "heartbeatExecution", context: { logMessage: '[cloud-container] execution heartbeat failed', details: { executionId, error } } }));
}
