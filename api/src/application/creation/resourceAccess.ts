/**
 * "May this caller place THESE resources on a board?" — THE resource-reference gate.
 *
 * A session permission never grants access to the resources placed inside it. Every
 * authoritative reference (`resourceType` + `resourceId`) on a graph object is validated
 * against the active tenant and segment before the object is written. Canvas-native
 * drafts have no resource ref and pass.
 *
 * It moved here from a closure inside `creationSessionRoutes` when the sync importer for
 * a canvas object (`creation/sync/importSyncedCanvasObject.ts`) became the second caller:
 * a second copy of an authorization check is the copy that keeps granting access after
 * the original learns to refuse. The route keeps a one-line wrapper over its own `db`.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  agentRegistrations,
  ceremonySessions,
  ideAgents,
  projects,
  tasks,
  tenantMembers,
  workflowDefinitions,
  workflows,
} from '../../infrastructure/database/schema';
import { resolveChatAccess } from '../brain/chatAccess';
import { partitionAgentRefs } from './agentRefPartition';
import { CREATION_UUID_RE as UUID_RE, type GraphObjectInput } from './creationGraphWriter';

/** The reason the references are refused, or null when every one is the caller's to use. */
export async function validateResourceAccess(
  db: Db,
  objects: GraphObjectInput[],
  tenantId: number,
  segmentId: string | null,
  userId: string,
): Promise<string | null> {
  if (!segmentId) return 'This session is missing its workspace segment';
  const refs = objects.filter((object) => object.resourceType && object.resourceId);
  const ids = (type: string) => [...new Set(refs.filter((object) => object.resourceType === type).map((object) => object.resourceId as string))];
  const numericIds = (type: string) => ids(type).map(Number).filter((id) => Number.isInteger(id) && id > 0);

  const projectIds = numericIds('project');
  if (projectIds.length !== ids('project').length) return 'A Project reference is invalid';
  if (projectIds.length) {
    const found = await db.select({ id: projects.id }).from(projects).where(and(
      eq(projects.tenantId, tenantId), eq(projects.segmentId, segmentId), inArray(projects.id, projectIds),
    ));
    if (found.length !== projectIds.length) return 'A Project is unavailable or belongs to another workspace';
  }

  const taskIds = numericIds('task');
  if (taskIds.length !== ids('task').length) return 'A Task reference is invalid';
  if (taskIds.length) {
    const found = await db.select({ id: tasks.id }).from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(projects.tenantId, tenantId), eq(tasks.segmentId, segmentId), inArray(tasks.id, taskIds)));
    if (found.length !== taskIds.length) return 'A Task is unavailable or belongs to another workspace';
  }

  const workflowIds = ids('workflow');
  if (workflowIds.length) {
    if (workflowIds.some((id) => !UUID_RE.test(id))) return 'A Workflow reference is invalid';
    const [definitions, executions] = await Promise.all([
      db.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(and(
        eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.segmentId, segmentId), inArray(workflowDefinitions.id, workflowIds),
      )),
      db.select({ id: workflows.id }).from(workflows).where(and(
        eq(workflows.tenantId, tenantId), eq(workflows.segmentId, segmentId), inArray(workflows.id, workflowIds),
      )),
    ]);
    if (new Set([...definitions, ...executions].map((row) => row.id)).size !== workflowIds.length) return 'A Workflow is unavailable or belongs to another workspace';
  }

  for (const chatId of ids('chat')) {
    const numeric = Number(chatId);
    if (!Number.isInteger(numeric) || !(await resolveChatAccess(db, { chatId: numeric, userId, tenantId }))) {
      return 'A Chat is unavailable or belongs to another workspace';
    }
  }

  const agentIds = ids('agent');
  if (agentIds.length) {
    // Numeric refs → `legacy_agent_id`; text refs → `ide_agents.id` (workforce and
    // built-in agents); only UUID-shaped text refs may reach the uuid column
    // `agent_registrations.id`. A ref neither finds is reported unavailable.
    const partition = partitionAgentRefs(agentIds);
    if (!partition) return 'An Agent is unavailable or belongs to another workspace';
    const { numeric, text, uuid: uuidRefs } = partition;
    const [byLegacy, workforce, byUuid] = await Promise.all([
      numeric.length
        ? db.select({ id: agentRegistrations.legacyAgentId }).from(agentRegistrations).where(and(
            eq(agentRegistrations.tenantId, tenantId),
            eq(agentRegistrations.segmentId, segmentId),
            inArray(agentRegistrations.legacyAgentId, numeric),
          ))
        : Promise.resolve([]),
      text.length
        ? db.select({ id: ideAgents.id }).from(ideAgents).where(and(eq(ideAgents.tenantId, tenantId), inArray(ideAgents.id, text)))
        : Promise.resolve([]),
      uuidRefs.length
        ? db.select({ id: agentRegistrations.id }).from(agentRegistrations).where(and(
            eq(agentRegistrations.tenantId, tenantId),
            eq(agentRegistrations.segmentId, segmentId),
            inArray(agentRegistrations.id, uuidRefs),
          ))
        : Promise.resolve([]),
    ]);
    const found = new Set<string>();
    for (const row of byLegacy) if (row.id != null) found.add(String(row.id));
    for (const row of workforce) found.add(row.id);
    for (const row of byUuid) found.add(row.id);
    if (agentIds.some((id) => !found.has(id))) return 'An Agent is unavailable or belongs to another workspace';
  }

  const ceremonyIds = ids('ceremony');
  if (ceremonyIds.length) {
    if (ceremonyIds.some((id) => !UUID_RE.test(id))) return 'A ceremony reference is invalid';
    const found = await db.select({ id: ceremonySessions.id }).from(ceremonySessions).where(and(
      eq(ceremonySessions.tenantId, tenantId), eq(ceremonySessions.segmentId, segmentId), inArray(ceremonySessions.id, ceremonyIds),
    ));
    if (found.length !== ceremonyIds.length) return 'A ceremony is unavailable or belongs to another workspace';
  }

  const staffIds = ids('staff');
  if (staffIds.length) {
    const found = await db.select({ userId: tenantMembers.userId }).from(tenantMembers).where(and(
      eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.userId, staffIds),
    ));
    if (found.length !== staffIds.length) return 'A staff member is unavailable or belongs to another workspace';
  }
  return null;
}
