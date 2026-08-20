/**
 * WHO an Auto/default run executes AS.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────────
 * `startDispatchedExecution` resolves the executing cloud agent from the payload pin,
 * else `tasks.assigned_agent_ref`. An Auto/default run has NEITHER, so `agent.ref` was
 * `undefined` and every downstream identity effect was skipped: the ticket was never
 * claimed, `executions.cloud_agent_ref` stayed NULL, and the run's tool-audit events
 * landed in the anonymous `DEFAULT_CLOUD_REF` bucket. The board could not say who
 * worked the ticket because nothing ever decided.
 *
 * ── WHY THIS IS NOT A THIRD RESOLUTION ──────────────────────────────────────────
 * Both tiers below are the resolutions the platform ALREADY uses to answer "which agent
 * should do this work", called in the order it already prefers them:
 *
 *   1. {@link recommendTopAssignee} with `agentOnly` — the availability-aware picker
 *      the manager's assign step and the stall-triage remedy use (`manager/assignOwner`).
 *      It honours WIP, availability and role capability, so an Auto run lands on the
 *      same agent a manual assignment would have chosen.
 *   2. {@link resolveRoleCapableAgents} — THE capability oracle (`kanban/roleCapability`),
 *      the same function the swimlane selector and the sign-off guard resolve through.
 *      Tier 1 is scoped to the project's TEAMS and returns only humans when a project
 *      has no team attached, which is the common case for a new workspace; the oracle
 *      reads the tenant's active agent roster plus its role pins, so it still answers.
 *
 * Neither is re-implemented here. This module only decides the ORDER, derives the role
 * constraint from the work (`producerRoleForActionType`, the same derivation
 * `assignTicketOwner` and `attributeRunToManifest` use), and — when nothing resolves —
 * returns a TYPED reason so the run records why it is anonymous instead of simply being
 * anonymous.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projects, tasks } from '../../infrastructure/database/schema';
import { recommendTopAssignee } from '../metrics/assigneeRecommender';
import { producerRoleForActionType, resolveRoleCapableAgents } from '../kanban/roleCapability';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/**
 * Why an Auto/default run could not be given a cloud-agent identity. A closed
 * vocabulary, because this value is recorded on the run's audit timeline and read back
 * by a human asking "who worked this ticket?" — "no agent" and "the lookup broke" are
 * different answers with different fixes.
 */
export type UnattributedRunReason =
  /** The workspace has no active cloud agent capable of this work. Fix: hire/enable one. */
  | 'no_capable_cloud_agent'
  /** The resolution itself failed (DB/cache error). Fix: retry; investigate the error. */
  | 'agent_resolution_failed';

/** Human-readable line per reason — one place, so the timeline and any caller agree. */
export const UNATTRIBUTED_RUN_MESSAGE: Record<UnattributedRunReason, string> = {
  no_capable_cloud_agent:
    'This run started with no cloud-agent identity: the workspace has no active cloud agent able to take this ticket, so the board cannot show who worked it. Hire or enable an agent in Workforce, or assign the ticket, and re-run.',
  agent_resolution_failed:
    'This run started with no cloud-agent identity because the default-agent lookup failed. The work still ran; re-run once to attribute it, and check the workspace roster if it recurs.',
};

export type DefaultCloudAgentResolution =
  | { ref: string; via: 'recommender' | 'role-oracle'; roleKey: string | null }
  | { ref: null; reason: UnattributedRunReason; roleKey: string | null };

/**
 * Resolve the cloud agent an Auto/default run should execute AS.
 *
 * Called ONLY when the caller pinned no agent and the ticket has no assignee — i.e. on
 * the path that previously ran anonymously — so it costs nothing on an attributed run.
 * Never throws: a failure to name an agent must degrade to a recorded reason, never to
 * a failed run.
 */
export async function resolveDefaultCloudAgentRef(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; taskId: number },
): Promise<DefaultCloudAgentResolution> {
  let roleKey: string | null = null;
  try {
    // The role the WORK implies. Tenant-scoped through the project join: a guessed
    // taskId must not read another workspace's ticket.
    const [row] = await db
      .select({ actionType: tasks.actionType })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, args.taskId), eq(projects.tenantId, args.tenantId)))
      .limit(1);
    roleKey = producerRoleForActionType(row?.actionType) ?? null;

    // (1) The availability-aware picker — the same one a manual/manager assignment uses.
    const top = await recommendTopAssignee(env, db, args.projectId, {
      agentOnly: true,
      ...(roleKey ? { roleKey } : {}),
    });
    if (top?.memberKind === 'cloud_agent') return { ref: top.memberRef, via: 'recommender', roleKey };

    // (2) The capability oracle — answers for a project with no team attached, which is
    // exactly where tier 1 returns nobody. Head of the list = strongest claim (an
    // explicit project role pin, then role_keys, then builtin_kind, then title/skill).
    // With no role constraint, 'developer' is the honest default for an Auto run: the
    // dispatch is a coding run on a ticket nobody classified.
    const oracleRole = roleKey ?? 'developer';
    const capable = await resolveRoleCapableAgents(env, db, args.tenantId, args.projectId, oracleRole);
    const head = capable[0];
    if (head) return { ref: head.ref, via: 'role-oracle', roleKey };

    return { ref: null, reason: 'no_capable_cloud_agent', roleKey };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/defaultCloudAgent.ts',
      operation: 'resolveDefaultCloudAgentRef',
      level: 'warning',
      context: { details: { tenantId: args.tenantId, projectId: args.projectId, taskId: args.taskId, error } },
    });
    return { ref: null, reason: 'agent_resolution_failed', roleKey };
  }
}
