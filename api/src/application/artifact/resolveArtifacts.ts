/**
 * Resolves the effective set of artifacts (skills, personas, content) for a
 * given execution context by querying all scope levels and merging with
 * precedence: task > project > agentHost > tenant.
 *
 * Higher-precedence scopes *add* to the set; they don't remove lower-scope
 * assignments. This gives users a union of everything assigned across the
 * hierarchy, with de-duplication by slug.
 */
import { eq, and, or, isNull } from 'drizzle-orm';
import {
  artifactAssignments,
  projectAgents,
  tasks,
} from '../../infrastructure/database/schema';
import {
  ArtifactType,
  AssignmentScope,
  type ResolvedArtifacts,
} from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';

export type ResolutionContext = {
  tenantId:   number;
  taskId?:    number;
  agentHostId?:    number;
  projectId?: number;
  /** project_agents.id — when executing as a specific agent, fold in its per-agent assignments. */
  agentAssignmentId?: number;
  /**
   * A workforce cloud agent's ide_agents.id. Resolved to the agent's canonical
   * (project-less) project_agents identity row so its per-agent assignments
   * follow it into any execution context, regardless of project.
   */
  cloudAgentRef?: string;
};

/**
 * Resolve the effective artifact set for the given context.
 *
 * Queries the unified `artifact_assignments` table for all matching scopes and
 * returns a de-duped union grouped by artifact type.
 */
export async function resolveArtifacts(
  db: Db,
  ctx: ResolutionContext,
): Promise<ResolvedArtifacts> {
  // Build scope conditions
  const scopeConditions: ReturnType<typeof and>[] = [];

  // Always include tenant-level
  scopeConditions.push(
    and(
      eq(artifactAssignments.scope, AssignmentScope.TENANT),
      eq(artifactAssignments.scopeId, ctx.tenantId),
    ),
  );

  // AgentHost-level
  if (ctx.agentHostId != null) {
    scopeConditions.push(
      and(
        eq(artifactAssignments.scope, AssignmentScope.HOST),
        eq(artifactAssignments.scopeId, ctx.agentHostId),
      ),
    );
  }

  // Project-level — resolve from task if needed
  let projectId = ctx.projectId;
  if (!projectId && ctx.taskId != null) {
    const [taskRow] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, ctx.taskId))
      .limit(1);
    projectId = taskRow?.projectId;
  }
  if (projectId != null) {
    scopeConditions.push(
      and(
        eq(artifactAssignments.scope, AssignmentScope.PROJECT),
        eq(artifactAssignments.scopeId, projectId),
      ),
    );
  }

  // Task-level
  if (ctx.taskId != null) {
    scopeConditions.push(
      and(
        eq(artifactAssignments.scope, AssignmentScope.TASK),
        eq(artifactAssignments.scopeId, ctx.taskId),
      ),
    );
  }

  // Agent-level — per-agent assignments keyed on project_agents.id. A workforce
  // cloud agent is addressed by its ide_agents.id, resolved here to its
  // canonical (project-less) identity row so capabilities follow the agent.
  let agentAssignmentId = ctx.agentAssignmentId;
  if (agentAssignmentId == null && ctx.cloudAgentRef != null) {
    const [identity] = await db
      .select({ id: projectAgents.id })
      .from(projectAgents)
      .where(and(
        eq(projectAgents.tenantId, ctx.tenantId),
        eq(projectAgents.agentKind, 'workforce'),
        eq(projectAgents.agentRef, ctx.cloudAgentRef),
        isNull(projectAgents.projectId),
      ))
      .limit(1);
    agentAssignmentId = identity?.id;
  }
  if (agentAssignmentId != null) {
    scopeConditions.push(
      and(
        eq(artifactAssignments.scope, AssignmentScope.AGENT),
        eq(artifactAssignments.scopeId, agentAssignmentId),
      ),
    );
  }

  const rows = await db
    .select({
      artifactType: artifactAssignments.artifactType,
      artifactSlug: artifactAssignments.artifactSlug,
    })
    .from(artifactAssignments)
    .where(and(
      eq(artifactAssignments.tenantId, ctx.tenantId),
      or(...scopeConditions),
    ));

  // De-dup by slug per type
  const skills   = new Set<string>();
  const personas = new Set<string>();
  const content  = new Set<string>();

  for (const row of rows) {
    switch (row.artifactType) {
      case ArtifactType.SKILL:   skills.add(row.artifactSlug);   break;
      case ArtifactType.PERSONA: personas.add(row.artifactSlug); break;
      case ArtifactType.CONTENT: content.add(row.artifactSlug);  break;
    }
  }

  return {
    skills:   [...skills],
    personas: [...personas],
    content:  [...content],
  };
}
