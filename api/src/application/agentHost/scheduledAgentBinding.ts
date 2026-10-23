/**
 * THE THREE "ASSIGN AN AGENT" NOTIONS, RECONCILED.
 *
 * A scheduled job can name an agent in three independent ways, and nothing checked that
 * they agreed:
 *
 *  1. `cron_jobs.agent_host_id` — the MACHINE the job executes on. Required.
 *  2. `agent_assignments` (scope 'project' / 'workspace') — an agent STAFFED on a project,
 *     or the agent's workspace identity.
 *  3. `cron_jobs.project_agent_id` — "run this schedule AS that agent", naming the
 *     assignment's integer `agent_handle`; NULL means project-wide.
 *
 * Because the three were decoupled, a cron job could be created naming a project agent
 * attached to a DIFFERENT project than the job's own `project_id`, or attached to a
 * project the job's host cannot reach, or belonging to another tenant entirely — and the
 * row saved cleanly. The mismatch only showed up at execution time as a schedule that
 * ran as nobody, or as the wrong agent, with no error anywhere pointing at the
 * configuration that caused it.
 *
 * This is the one place that decides whether a (host, project, project-agent) triple is
 * coherent, so the create path can REFUSE an incoherent one instead of persisting it and
 * the execution path can resolve the same answer without re-deriving the rule.
 *
 * Migration 1265 folded `project_agents` into `agent_assignments` (keeping each old id as
 * the row's `agent_handle`, so `cron_jobs.project_agent_id` kept pointing at the same
 * agent). The coherence rules below are unchanged by that: a project row must name the
 * schedule's project; a workspace identity is the same agent, not pinned to any project.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentHostProjects } from '../../infrastructure/database/schema';
import { AgentAssignmentService } from '../agent/AgentAssignmentService';
import { CONFIGURABLE_SCOPES } from '../agent/agentAssignmentModel';

/** Why a (host, project, project-agent) triple was refused. */
export type ScheduledAgentProblem =
  /** The named agent assignment (by handle) does not exist in this tenant. */
  | 'agent_not_found'
  /** The agent is attached to a different project than the schedule's own. */
  | 'agent_project_mismatch'
  /** The schedule names an agent but no project, so "attached to what?" has no answer. */
  | 'agent_without_project'
  /** The host is not attached to the schedule's project, so it cannot reach the work. */
  | 'host_project_mismatch';

export interface ScheduledAgentBinding {
  ok: true;
  /** The attached agent this schedule runs AS, or null for a project-wide schedule. */
  projectAgentId: number | null;
  /** Its (kind, ref) identity — what the executor attributes the run to. */
  agentKind: string | null;
  agentRef: string | null;
}

export interface ScheduledAgentRefusal {
  ok: false;
  problem: ScheduledAgentProblem;
  detail: string;
}

export type ScheduledAgentResult = ScheduledAgentBinding | ScheduledAgentRefusal;

const refuse = (problem: ScheduledAgentProblem, detail: string): ScheduledAgentRefusal =>
  ({ ok: false, problem, detail });

/**
 * Reconcile the three notions for one schedule.
 *
 * A project-wide schedule (no `projectAgentId`) is always coherent as far as the AGENT is
 * concerned — there is no agent to disagree with — but its HOST still has to be attached
 * to the project when one is named, because a host that cannot reach the project cannot
 * run the schedule.
 */
export async function resolveScheduledAgentBinding(
  db: Db,
  args: {
    tenantId: number;
    agentHostId: number;
    projectId: number | null;
    projectAgentId: number | null;
  },
): Promise<ScheduledAgentResult> {
  // 1. HOST ↔ PROJECT. Only checkable when the schedule names a project; a host with no
  //    project attachments at all is left alone, because plenty of hosts run
  //    tenant-scoped schedules and refusing those would break them.
  if (args.projectId != null) {
    const attachments = await db
      .select({ projectId: agentHostProjects.projectId })
      .from(agentHostProjects)
      .where(and(
        eq(agentHostProjects.tenantId, args.tenantId),
        eq(agentHostProjects.agentHostId, args.agentHostId),
      ));
    if (attachments.length > 0 && !attachments.some((a) => a.projectId === args.projectId)) {
      return refuse(
        'host_project_mismatch',
        `Agent host ${args.agentHostId} is attached to other projects but not to project ${args.projectId}, so it cannot run this schedule's work.`,
      );
    }
  }

  // 2. A PROJECT-WIDE SCHEDULE. Nothing further to reconcile.
  if (args.projectAgentId == null) {
    return { ok: true, projectAgentId: null, agentKind: null, agentRef: null };
  }

  // 3. "Run AS this agent" needs a project to be attached to.
  if (args.projectId == null) {
    return refuse(
      'agent_without_project',
      'This schedule names an attached agent but no project, so there is nothing for the agent to be attached to.',
    );
  }

  // 4. THE AGENT ↔ PROJECT STAFFING. A workspace IDENTITY row (no project) is accepted
  //    for the same agent — it is the same agent, simply not pinned to a project — which
  //    is what keeps a tenant-level agent usable on a project schedule. Any other scope
  //    (a lane, a chat invite) is not an agent a schedule can run as.
  const found = await new AgentAssignmentService(db).find(args.tenantId, String(args.projectAgentId));
  const row = found && CONFIGURABLE_SCOPES.includes(found.scope) ? found : null;
  if (!row) {
    return refuse('agent_not_found', `No attached agent ${args.projectAgentId} exists in this workspace.`);
  }
  if (row.projectId != null && row.projectId !== args.projectId) {
    return refuse(
      'agent_project_mismatch',
      `Attached agent ${args.projectAgentId} belongs to project ${row.projectId}, not to project ${args.projectId}.`,
    );
  }

  return { ok: true, projectAgentId: row.agentHandle, agentKind: row.agentKind, agentRef: row.agentRef };
}
