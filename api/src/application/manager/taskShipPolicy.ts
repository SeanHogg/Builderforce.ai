/**
 * taskShipPolicy — the ship policy an ON-PREM agent host's run follows (PRD 48 §4.4).
 *
 * An agent host builds its own prompt, so it gets the policy the same way the cloud prompt
 * does — the project's CLOUD policy from the one mapper (`shipPolicyOf.ts`) — plus the ONE
 * directive text (`shipDirective`), through its run payload. No second copy of the prose
 * lives on the host.
 */
import { eq } from 'drizzle-orm';
import { shipDirective, type ShipPolicy } from '@builderforce/run-guards';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getCloudShipPolicy } from './managerPolicyStore';
import { DEFAULT_MANAGER_POLICY } from './managerPolicy';
import { shipPoliciesOf } from './shipPolicyOf';

export interface RunShipPayload {
  shipPolicy: ShipPolicy;
  /** The directive to put in the run's system prompt, verbatim. */
  shipDirective: string;
}

/** The ship payload for a task's run, or null when the task (or its project) is not in this tenant. */
export async function runShipPayloadForTask(
  db: Db, tenantId: number, taskId: number, env?: Env,
): Promise<RunShipPayload | null> {
  // A failed read must never fail the dispatch: it is REPORTED and the run gets the built-in
  // policy (a PR nothing merges) — the same fallback `getCloudShipPolicy` gives the cloud prompt.
  let projectId: number | null;
  try {
    const [task] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId)))
      .limit(1);
    if (!task) return null;
    projectId = task.projectId ?? null;
  } catch (error) {
    reportCaughtError(error, { source: 'application/manager/taskShipPolicy.ts', operation: 'runShipPayloadForTask', context: { tenantId, taskId } });
    projectId = null;
  }
  const shipPolicy = projectId != null
    ? await getCloudShipPolicy(db, tenantId, projectId, env)
    : shipPoliciesOf(DEFAULT_MANAGER_POLICY, false).cloud;
  // `cloud` wording: an on-prem host commits, pushes and opens the PR itself after the agent
  // finishes (agent-runtime `builderforce-coding-dispatch.ts` tells the agent not to run git),
  // so — like a cloud run — the agent's own tools never publish.
  return { shipPolicy, shipDirective: shipDirective(shipPolicy, { host: 'cloud' }) };
}
