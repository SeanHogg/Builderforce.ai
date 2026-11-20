/**
 * runHostBinding — the ONE answer to "will this run execute on an on-prem agent host?".
 *
 * The dispatcher (`startDispatchedExecution`) delivers a run to a host exactly when a host is
 * PINNED (the per-run `agentHostId`, else the ticket's `assigned_agent_host_id`) AND the agent
 * that executes it permits host execution (`runtime_support !== 'cloud'`). That decision is
 * {@link isHostBoundRun}, and the dispatcher itself calls it — so a caller that asks the same
 * question before dispatching ({@link wouldRunOnHost}) cannot drift from where the run goes.
 *
 * PRD 48 §4.6 asks it before a merge grant is accepted: a grant is for a CLOUD run only.
 */
import type { Env } from '../../env';
import { agentAllowsHostExecution, resolveCloudAgent } from './cloudAgentEngine';
import { parseCloudAgentRef } from './cloudDispatch';

/** The dispatcher's own routing rule: a pinned host AND an agent that may run on one. */
export function isHostBoundRun(pinnedHostId: number | null | undefined, runtimeSupport: string | undefined): boolean {
  return pinnedHostId != null && agentAllowsHostExecution(runtimeSupport);
}

/**
 * Before dispatch: would this run be host-bound? Pins the host the dispatcher would pin and
 * resolves the agent it would resolve (the payload's `cloudAgentRef`, else the ticket's assigned
 * agent). With no named agent the dispatcher would pick a default whose runtime is not known yet,
 * so a pinned host answers "yes" — the conservative side for a grant that must not reach a host.
 */
export async function wouldRunOnHost(
  env: Env, tenantId: number,
  a: { agentHostId?: number | null; task: { assignedAgentHostId: number | null; assignedAgentRef: string | null }; payload?: string },
): Promise<boolean> {
  const pinnedHostId = a.agentHostId ?? a.task.assignedAgentHostId;
  if (pinnedHostId == null) return false;
  const ref = parseCloudAgentRef(a.payload) ?? a.task.assignedAgentRef ?? undefined;
  if (!ref) return true;
  const agent = await resolveCloudAgent(env, tenantId, ref);
  return isHostBoundRun(pinnedHostId, agent.runtimeSupport);
}
