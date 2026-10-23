/**
 * Resolves the effective set of artifacts (skills, personas, content) for a
 * given execution context by querying all scope levels and merging with
 * precedence: task > project > agentHost > tenant.
 *
 * Higher-precedence scopes *add* to the set; they don't remove lower-scope
 * assignments. This gives users a union of everything assigned across the
 * hierarchy, with de-duplication by slug.
 */
import { eq, and, or, inArray } from 'drizzle-orm';
import {
  agentHostProjects,
  agentRegistrations,
  artifactAssignments,
  tasks,
} from '../../infrastructure/database/schema';
import { AgentAssignmentService } from '../agent/AgentAssignmentService';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
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
  /** `agent_assignments.agent_handle` — when executing as a specific agent, fold in its per-agent assignments. */
  agentAssignmentId?: number;
  /**
   * A workforce cloud agent's ide_agents.id. Resolved to the agent's workspace identity
   * (`agent_assignments`, scope 'workspace') so its per-agent assignments follow it into
   * any execution context, regardless of project.
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
  const scopeConditions = await sharedScopeConditions(db, ctx);

  // Agent-level — per-agent assignments keyed on the assignment's integer handle. A
  // workforce cloud agent is addressed by its ide_agents.id, resolved here to its
  // workspace identity so capabilities follow the agent.
  let agentAssignmentId = ctx.agentAssignmentId;
  if (agentAssignmentId == null && ctx.cloudAgentRef != null) {
    const handles = await new AgentAssignmentService(db).identityHandles(ctx.tenantId, 'workforce', [ctx.cloudAgentRef]);
    agentAssignmentId = handles.get(ctx.cloudAgentRef);
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
      // WHERE the assignment lives. The result is a union across the whole hierarchy,
      // so without this an agent-pinned skill and a tenant-wide one are the same string.
      scope:        artifactAssignments.scope,
    })
    .from(artifactAssignments)
    .where(and(
      eq(artifactAssignments.tenantId, ctx.tenantId),
      or(...scopeConditions),
    ));

  return mergeAssignments(rows);
}

/**
 * `resolveArtifacts` for several workforce cloud agents in ONE execution context
 * (e.g. every agent staffed on a lane). The task, identity and assignment reads
 * run once for the whole set instead of once per agent; each agent's entry is
 * what `resolveArtifacts` returns for that `cloudAgentRef`.
 */
export async function resolveArtifactsForCloudAgents(
  db: Db,
  ctx: Omit<ResolutionContext, 'cloudAgentRef' | 'agentAssignmentId'>,
  cloudAgentRefs: string[],
): Promise<Map<string, ResolvedArtifacts>> {
  const refs = [...new Set(cloudAgentRefs)];
  const result = new Map<string, ResolvedArtifacts>();
  if (!refs.length) return result;

  const [scopeConditions, identityByRef] = await Promise.all([
    sharedScopeConditions(db, ctx),
    new AgentAssignmentService(db).identityHandles(ctx.tenantId, 'workforce', refs),
  ]);
  const identityIds = [...new Set(identityByRef.values())];
  if (identityIds.length) {
    scopeConditions.push(
      and(
        eq(artifactAssignments.scope, AssignmentScope.AGENT),
        inArray(artifactAssignments.scopeId, identityIds),
      ),
    );
  }

  const rows = await db
    .select({
      artifactType: artifactAssignments.artifactType,
      artifactSlug: artifactAssignments.artifactSlug,
      scope:        artifactAssignments.scope,
      scopeId:      artifactAssignments.scopeId,
    })
    .from(artifactAssignments)
    .where(and(
      eq(artifactAssignments.tenantId, ctx.tenantId),
      or(...scopeConditions),
    ));

  for (const ref of refs) {
    const identityId = identityByRef.get(ref);
    // Every shared-scope row, plus only THIS agent's own agent-scope rows.
    result.set(ref, mergeAssignments(rows.filter((row) =>
      row.scope !== AssignmentScope.AGENT || row.scopeId === identityId)));
  }
  return result;
}

/**
 * Everything resolvable for ANY run on one agent host: the tenant-wide and host grants,
 * plus the project grants of every project bound to the host (`agent_host_projects`) and
 * the agent grants of every agent registered on it. The on-prem runtime syncs its skills
 * directory against this — a run on the host can resolve no artifact outside it — so the
 * union is the same merge {@link resolveArtifacts} applies to one run, widened to every
 * run the host can serve.
 */
export async function resolveArtifactsForHost(
  db: Db,
  tenantId: number,
  agentHostId: number,
): Promise<ResolvedArtifacts> {
  const [scopeConditions, boundProjects, registrations] = await Promise.all([
    sharedScopeConditions(db, { tenantId, agentHostId }),
    db
      .select({ projectId: agentHostProjects.projectId })
      .from(agentHostProjects)
      .where(scopedToTenant(agentHostProjects, tenantId, eq(agentHostProjects.agentHostId, agentHostId))),
    db
      .select({ id: agentRegistrations.id })
      .from(agentRegistrations)
      .where(scopedToTenant(agentRegistrations, tenantId, eq(agentRegistrations.agentHostId, agentHostId))),
  ]);
  const projectIds = [...new Set(boundProjects.map((p) => p.projectId))];
  if (projectIds.length) {
    scopeConditions.push(
      and(
        eq(artifactAssignments.scope, AssignmentScope.PROJECT),
        inArray(artifactAssignments.scopeId, projectIds),
      ),
    );
  }
  const refs = registrations.map((r) => r.id);
  const handles = refs.length
    ? [...new Set((await new AgentAssignmentService(db).identityHandles(tenantId, 'registered', refs)).values())]
    : [];
  if (handles.length) {
    scopeConditions.push(
      and(
        eq(artifactAssignments.scope, AssignmentScope.AGENT),
        inArray(artifactAssignments.scopeId, handles),
      ),
    );
  }
  const rows = await db
    .select({
      artifactType: artifactAssignments.artifactType,
      artifactSlug: artifactAssignments.artifactSlug,
      scope:        artifactAssignments.scope,
    })
    .from(artifactAssignments)
    .where(and(
      eq(artifactAssignments.tenantId, tenantId),
      or(...scopeConditions),
    ));
  return mergeAssignments(rows);
}

/** Tenant, host, project and task scope conditions: every level except the agent's. */
async function sharedScopeConditions(
  db: Db,
  ctx: ResolutionContext,
): Promise<ReturnType<typeof and>[]> {
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
      .where(scopedToTenant(tasks, ctx.tenantId, eq(tasks.id, ctx.taskId)))
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

  return scopeConditions;
}

/** Merge assignment rows into the de-duped, per-type result with each slug's source scope. */
function mergeAssignments(
  rows: ReadonlyArray<{ artifactType: string; artifactSlug: string; scope: string | null }>,
): ResolvedArtifacts {
  // De-dup by slug per type
  const skills   = new Set<string>();
  const personas = new Set<string>();
  // Most-specific scope wins per slug — the same precedence the merge documents.
  const sources: Record<string, AssignmentScope> = {};

  for (const row of rows) {
    switch (row.artifactType) {
      case ArtifactType.SKILL:   skills.add(row.artifactSlug);   break;
      case ArtifactType.PERSONA: personas.add(row.artifactSlug); break;
      // ArtifactType.AGENT is a MARKETPLACE artifact (what a workspace bought),
      // never a capability assigned to a scope, so it contributes to neither
      // bucket and is deliberately not a case here.
    }
    const scope = normalizeScope(row.scope);
    if (scope == null) continue;
    const held = sources[row.artifactSlug];
    if (held == null || SCOPE_SPECIFICITY[scope] > SCOPE_SPECIFICITY[held]) {
      sources[row.artifactSlug] = scope;
    }
  }

  return {
    skills:   [...skills],
    personas: [...personas],
    // ALWAYS EMPTY since migration 0982 retired `artifact_type = 'content'`. The
    // field is kept because the runtime payload, the capability timeline event and
    // the workforce manifest panel all read it; dropping it would be a contract
    // break for an array that is now simply never populated. Content lives in
    // `knowledge_documents` and is resolved by the knowledge subsystem instead.
    content:  [],
    sources,
  };
}

/** How specific each scope is — higher wins when the same slug is assigned twice. */
const SCOPE_SPECIFICITY: Record<AssignmentScope, number> = {
  [AssignmentScope.TENANT]:  0,
  [AssignmentScope.HOST]:    1,
  [AssignmentScope.PROJECT]: 2,
  [AssignmentScope.TASK]:    3,
  [AssignmentScope.AGENT]:   4,
};

/** Coerce the raw scope column to the enum; an unknown value is left unlabelled. */
function normalizeScope(raw: string | null | undefined): AssignmentScope | null {
  return (Object.values(AssignmentScope) as string[]).includes(raw ?? '')
    ? (raw as AssignmentScope)
    : null;
}
