/**
 * Task dependency edges (migration 0121) — the graph behind the dependency-map
 * visualizer and roadmap sequencing.
 *
 * An edge predecessor → successor means "predecessor must finish before successor
 * can start". The set of edges for a project MUST stay a DAG: a cycle breaks
 * topological ordering, Gantt scheduling, and the flow graph. We enforce that at
 * WRITE time here (a data-integrity gate) — the DB only stops self-loops and
 * duplicate edges; the viz still defends by flagging any cycle edge it sees.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { taskDependencies, tasks, projects } from '../../infrastructure/database/schema';

export interface DependencyEdge {
  id: number;
  projectId: number;
  predecessorTaskId: number;
  successorTaskId: number;
  depType: string;
  createdAt: Date;
}

/** A task confirmed to belong to `tenantId`, with its project. */
export interface ScopedTask {
  id: number;
  projectId: number;
}

/** Load a task iff it belongs to the tenant (tasks carry no tenant_id of their
 *  own — tenancy is established by joining projects). */
export async function loadTenantTask(db: Db, taskId: number, tenantId: number): Promise<ScopedTask | null> {
  const [row] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, taskId), eq(projects.tenantId, tenantId)));
  return row ?? null;
}

/** All dependency edges for a project (the full adjacency set). */
export async function listProjectDependencies(db: Db, projectId: number): Promise<DependencyEdge[]> {
  return db
    .select({
      id: taskDependencies.id,
      projectId: taskDependencies.projectId,
      predecessorTaskId: taskDependencies.predecessorTaskId,
      successorTaskId: taskDependencies.successorTaskId,
      depType: taskDependencies.depType,
      createdAt: taskDependencies.createdAt,
    })
    .from(taskDependencies)
    .where(eq(taskDependencies.projectId, projectId));
}

/**
 * Would adding `predecessor → successor` create a cycle? It does iff `successor`
 * can already reach `predecessor` along existing precedence edges. BFS forward
 * (predecessor → successor) from `successor`; if we arrive at `predecessor`, the
 * new edge would close a loop. O(V+E) over the project's edges, loaded once.
 */
export function hasPathReachingTarget(
  edges: DependencyEdge[],
  fromTaskId: number,
  targetTaskId: number,
): boolean {
  const adjacency = new Map<number, number[]>();
  for (const e of edges) {
    const list = adjacency.get(e.predecessorTaskId);
    if (list) list.push(e.successorTaskId);
    else adjacency.set(e.predecessorTaskId, [e.successorTaskId]);
  }
  const queue: number[] = [fromTaskId];
  const seen = new Set<number>([fromTaskId]);
  while (queue.length) {
    const current = queue.shift() as number;
    if (current === targetTaskId) return true;
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Dependency edge semantics. finish_to_start (default) = predecessor must finish
 *  before successor starts; the rest mirror standard PM scheduling relations. */
export const DEP_TYPES = ['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'] as const;
export type DepType = (typeof DEP_TYPES)[number];
export function isDepType(v: unknown): v is DepType {
  return typeof v === 'string' && (DEP_TYPES as readonly string[]).includes(v);
}

export type AddDependencyResult =
  | { ok: true; edge: DependencyEdge }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Add a precedence edge after validating: both tasks exist under the tenant, live
 * in the same project, are distinct, the edge does not already exist, and adding
 * it keeps the graph acyclic.
 */
export async function addDependency(
  db: Db,
  tenantId: number,
  successorTaskId: number,
  predecessorTaskId: number,
  depType: DepType = 'finish_to_start',
): Promise<AddDependencyResult> {
  if (successorTaskId === predecessorTaskId) {
    return { ok: false, status: 400, error: 'a task cannot depend on itself' };
  }
  const [successor, predecessor] = await Promise.all([
    loadTenantTask(db, successorTaskId, tenantId),
    loadTenantTask(db, predecessorTaskId, tenantId),
  ]);
  if (!successor || !predecessor) return { ok: false, status: 404, error: 'task not found' };
  if (successor.projectId !== predecessor.projectId) {
    return { ok: false, status: 400, error: 'dependencies must be within the same project' };
  }

  const projectId = successor.projectId;
  const edges = await listProjectDependencies(db, projectId);
  if (edges.some((e) => e.predecessorTaskId === predecessorTaskId && e.successorTaskId === successorTaskId)) {
    return { ok: false, status: 409, error: 'dependency already exists' };
  }
  // Cycle gate: reject if successor already reaches predecessor.
  if (hasPathReachingTarget(edges, successorTaskId, predecessorTaskId)) {
    return { ok: false, status: 400, error: 'would create a dependency cycle' };
  }

  const rows = (await db
    .insert(taskDependencies)
    .values({ tenantId, projectId, predecessorTaskId, successorTaskId, depType })
    .returning()) as DependencyEdge[];
  const edge = rows[0]!;

  // Close the check-then-insert race: the pre-check + insert are not atomic
  // (neon-http has no interactive transactions / advisory locks), so a concurrent
  // insert of the reverse path could have slipped in between, making our edge
  // close a cycle. Re-verify against the now-current edge set and compensate by
  // deleting our edge if so. (Our P→S edge can't itself create an S→P path, so a
  // positive result means a genuine concurrent reverse path exists.)
  const after = await listProjectDependencies(db, projectId);
  if (hasPathReachingTarget(after, successorTaskId, predecessorTaskId)) {
    await db.delete(taskDependencies).where(eq(taskDependencies.id, edge.id));
    return { ok: false, status: 400, error: 'would create a dependency cycle' };
  }
  return { ok: true, edge };
}

/** Delete an edge by id, scoped to the tenant. Returns the deleted edge or null. */
export async function deleteDependency(
  db: Db,
  tenantId: number,
  edgeId: number,
): Promise<DependencyEdge | null> {
  const [row] = (await db
    .delete(taskDependencies)
    .where(and(eq(taskDependencies.id, edgeId), eq(taskDependencies.tenantId, tenantId)))
    .returning()) as DependencyEdge[];
  return row ?? null;
}
