/**
 * Writing a workflow definition — the ONE path.
 *
 * Creating a definition is never just an INSERT. Three things must happen
 * together or the row is quietly broken:
 *   1. the row is written;
 *   2. `syncDefinitionTriggers` materialises the graph's trigger nodes into
 *      `workflow_triggers`, or the workflow exists and never fires;
 *   3. the tenant's cached definition list is dropped, or the new workflow is
 *      missing from the Workflows page for the length of the cache TTL.
 *
 * There were four hand-written copies of that sequence in
 * `workflowDefinitionRoutes` alone — create, import, from-canvas and fork — and
 * `from-canvas` had already drifted: it read its row back scoped by id ALONE
 * where the other three scope by tenant as well. Installing a template would
 * have been a fifth copy, so the sequence lives here and every caller runs the
 * same one.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { workflowDefinitions } from '../../infrastructure/database/schema';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { WorkflowDefinition } from '../../domain/workflowGraph';
import { syncDefinitionTriggers } from './triggerSync';
import { runTargetFromDefinition, type WorkflowRuntime } from './instantiateRun';

/** Cache key for a tenant's workflow-definition list. Owned here because the
 *  writer is what invalidates it; the route reads the same constant. */
export const workflowDefinitionListCacheKey = (tenantId: number): string => `wfdef:list:${tenantId}`;

/** The persisted run target, in the column shape the table stores. */
export interface StoredRunTarget {
  runTargetRuntime: WorkflowRuntime;
  runTargetAgentHostId: number | null;
  runTargetCloudAgentRef: string | null;
}

/** Normalise an incoming run target into the columns + a coherent pair: a cloud
 *  target must not carry a host id, and vice versa. */
export function coerceRunTarget(input: {
  runTargetRuntime?: string | null;
  runTargetAgentHostId?: number | null;
  runTargetCloudAgentRef?: string | null;
}): StoredRunTarget {
  const runtime: WorkflowRuntime = input.runTargetRuntime === 'cloud' ? 'cloud' : 'host';
  return {
    runTargetRuntime: runtime,
    runTargetAgentHostId: runtime === 'host' ? input.runTargetAgentHostId ?? null : null,
    runTargetCloudAgentRef: runtime === 'cloud' ? input.runTargetCloudAgentRef ?? null : null,
  };
}

/** Normalise execution scope to the two allowed values. */
export function coerceExecutionScope(v: string | null | undefined): 'project' | 'global' {
  return v === 'global' ? 'global' : 'project';
}

/**
 * The project binding is the source of truth for scope: bound ⇒ 'project',
 * unbound ⇒ 'global'. An explicit scope applies only when the binding itself is
 * left untouched.
 */
export function scopeFromProject(
  projectId: number | null | undefined,
  fallback: string | null | undefined,
): 'project' | 'global' {
  if (projectId !== undefined) return projectId != null ? 'project' : 'global';
  return coerceExecutionScope(fallback);
}

export interface CreateDefinitionArgs {
  tenantId: number;
  segmentId: string | null;
  name: string;
  description?: string | null;
  projectId?: number | null;
  definition: WorkflowDefinition;
  target: StoredRunTarget;
  executionScope?: string | null;
  /** Fork lineage, when this definition is a copy of another. */
  parentDefinitionId?: string | null;
}

export type WorkflowDefinitionRow = typeof workflowDefinitions.$inferSelect;

/**
 * Create a definition, materialise its triggers and drop the list cache.
 *
 * The read-back is scoped by tenant as well as id. The id is a freshly generated
 * uuid so the read cannot cross a boundary in practice — but `check-tenant-scope`
 * counts statements rather than reachability, and a read that is only safe
 * because of how its id happened to be produced stops being safe the moment
 * somebody reuses the helper.
 */
export async function createWorkflowDefinition(
  db: Db,
  env: Env,
  args: CreateDefinitionArgs,
): Promise<WorkflowDefinitionRow> {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(workflowDefinitions).values({
    id,
    tenantId: args.tenantId,
    segmentId: args.segmentId,
    name: args.name.trim().slice(0, 200),
    description: args.description ?? null,
    projectId: args.projectId ?? null,
    definition: JSON.stringify(args.definition),
    ...args.target,
    executionScope: scopeFromProject(args.projectId, args.executionScope),
    ...(args.parentDefinitionId ? { parentDefinitionId: args.parentDefinitionId } : {}),
    createdAt: now,
    updatedAt: now,
  });

  await syncDefinitionTriggers(db, {
    definitionId: id,
    tenantId: args.tenantId,
    segmentId: args.segmentId,
    definition: args.definition,
    target: runTargetFromDefinition(args.target),
    env,
  });

  await invalidateCached(env, workflowDefinitionListCacheKey(args.tenantId));

  const [row] = await db
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, args.tenantId)));
  if (!row) throw new Error('Workflow definition disappeared immediately after creation');
  return row;
}
