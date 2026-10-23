/**
 * The agent-assignment vocabulary — the types, scope list, row mapping and cache-version
 * key shared by {@link AgentAssignmentService} and the route/tool surfaces that speak it.
 *
 * Split out of the service so a presenter (the REST router, the Brain tools) can name the
 * scopes and the row shape without importing the service's Db dependencies.
 */
import type { agentAssignments } from '../../infrastructure/database/schema';

/** The platform aspects an agent can be assigned to. */
export type AssignmentScope =
  | 'project'
  | 'workflow'
  | 'security'
  | 'swimlane'
  | 'brain'
  | 'chat'      // an agent invited into a specific Brain chat (scopeId = chat id)
  | 'global'
  /**
   * The agent's tenant-wide IDENTITY in a workspace (scopeId NULL) — what a bridged or
   * hired workforce agent is configured through. Not an assignment to run anywhere; its
   * `agentHandle` is what per-agent skills/personas and governance hang off (migration
   * 1265, which folded the `project_agents` identity rows in).
   */
  | 'workspace';

/** The scopes the REST surface accepts. `chat` is written by the Brain chat routes only. */
export const ROUTABLE_SCOPES: readonly AssignmentScope[] = [
  'project',
  'workflow',
  'security',
  'swimlane',
  'brain',
  'global',
  'workspace',
];

export type ExecutionScope = 'project' | 'global';

export type AgentKind = 'workforce' | 'registered';

export const AGENT_KINDS: readonly AgentKind[] = ['workforce', 'registered'];

/** The scopes whose rows are an AGENT a workspace configures (capabilities, governance,
 *  schedules) — the targets `artifact_assignments.scope = 'agent'` may name by handle. */
export const CONFIGURABLE_SCOPES: readonly AssignmentScope[] = ['project', 'workspace'];

export interface AgentAssignment {
  id: string;
  /** The integer handle per-agent capability assignments and schedules key on. */
  agentHandle: number;
  agentKind: string;
  agentRef: string;
  scope: AssignmentScope;
  scopeId: string | null;
  /** Set for `scope = 'project'` rows — the staffed project. */
  projectId: number | null;
  executionScope: ExecutionScope;
  role: string;
  /** Display name captured at assign time. */
  name: string | null;
  /** Per-agent rules bound into this agent's runs. */
  governance: string | null;
  addedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssignInput {
  agentKind: string;
  agentRef: string;
  scope: AssignmentScope;
  scopeId?: string | null;
  executionScope?: ExecutionScope;
  role?: string;
  name?: string | null;
  addedBy?: string | null;
  /**
   * What an existing equivalent assignment gets: `'update'` (default) applies the
   * provided executionScope/role/name; `'keep'` returns it untouched — the staffing
   * side-effects (role roster, hire provisioning) must not overwrite an operator's choice.
   */
  onExisting?: 'update' | 'keep';
}

/** The per-tenant version token every cached assignment read folds into its key. */
export const agentAssignmentsVersionKey = (tenantId: number): string => `agent-assignments:${tenantId}`;

/**
 * The canonical text of a scopeId: a project id is written `String(Number(id))` so
 * `'012'` and `'12'` name the same project (and the same unique-index slot); a
 * workspace identity has none. Every other scope's id is stored as given.
 */
export function normaliseScopeId(scope: AssignmentScope, scopeId: string | null): string | null {
  if (scope === 'workspace' || scopeId == null) return null;
  const trimmed = scopeId.trim();
  if (scope === 'project' && /^\d{1,9}$/.test(trimmed)) return String(Number(trimmed));
  return trimmed;
}

/** A `scope = 'project'` row's project id, derived from its scopeId. */
export function projectIdForScope(scope: AssignmentScope, scopeId: string | null): number | null {
  if (scope !== 'project' || scopeId == null || !/^\d{1,9}$/.test(scopeId)) return null;
  return Number(scopeId);
}

const iso = (d: Date | string | null | undefined): string =>
  d instanceof Date ? d.toISOString() : String(d ?? '');

export function toAssignment(row: typeof agentAssignments.$inferSelect): AgentAssignment {
  return {
    id: row.id,
    agentHandle: row.agentHandle,
    agentKind: row.agentKind,
    agentRef: row.agentRef,
    scope: row.scope as AssignmentScope,
    scopeId: row.scopeId,
    projectId: row.projectId ?? null,
    executionScope: row.executionScope as ExecutionScope,
    role: row.role,
    name: row.name ?? null,
    governance: row.governance ?? null,
    addedBy: row.addedBy ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
