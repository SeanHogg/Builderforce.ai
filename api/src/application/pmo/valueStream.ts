/**
 * VALUE STREAM — /api/pmo/value-stream
 *
 * The cross-artifact value-delivery graph: the initiative dependency network with
 * each initiative's delivery progress and where flow is blocked, so a stakeholder
 * can see "where is THIS piece of value stuck in the chain." It is the graph
 * complement to the (deliverable-scoped) delivery lens and the (text-only) PMO
 * rollup critical path.
 *
 * It REUSES {@link computeDependencyAnalysis} (the same critical-path / blocked-by
 * / cycle math the rollup uses — single source of truth) and adds a per-initiative
 * task rollup (total / completed → completion %) computed from ONE bounded query
 * over tasks (effective initiative = task.initiativeId ?? project.initiativeId, the
 * same join the delivery lens uses), so there is no N+1 across initiatives.
 *
 * The assembly ({@link buildValueStream}) is a pure function over fetched rows and
 * is unit-tested without a DB; {@link computeValueStream} is the thin DB shell.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { initiatives, pmoDependencies, projects, tasks } from '../../infrastructure/database/schema';
import { computeDependencyAnalysis, type DepEdge, type DepInitiative } from './portfolioRollup';

const MAX_TASK_ROWS = 20_000;

/** Statuses that count a task as delivered (mirrors reportRoutes / bottleneck). */
const DONE_TASK_STATUSES = new Set(['done', 'completed', 'archived', 'shipped']);

export interface ValueStreamInitiative {
  id: string;
  name: string;
  status: string;
  /** On the longest chain of still-incomplete initiatives (the critical path). */
  onCriticalPath: boolean;
  /** Ids of initiatives blocking this one. */
  blockedBy: string[];
  totalTasks: number;
  completedTasks: number;
  completionPct: number;
}

export interface ValueStreamEdge {
  id: string;
  fromInitiativeId: string;
  toInitiativeId: string;
  /** Both endpoints are consecutive on the critical path. */
  onCriticalPath: boolean;
}

export interface ValueStream {
  nodes: ValueStreamInitiative[];
  edges: ValueStreamEdge[];
  criticalPath: string[];
  cycleDetected: boolean;
}

export interface VsInitiativeRow { id: string; name: string; status: string }
export interface VsEdgeRow { id: string; fromInitiativeId: string; toInitiativeId: string }
export interface VsTaskRow { initiativeId: string; status: string }

/** Pure: initiatives + dependency edges + task rows → the assembled value stream. */
export function buildValueStream(
  inits: VsInitiativeRow[],
  edges: VsEdgeRow[],
  taskRows: VsTaskRow[],
): ValueStream {
  const depInits: DepInitiative[] = inits.map((i) => ({ id: i.id, name: i.name, status: i.status }));
  const depEdges: DepEdge[] = edges.map((e) => ({ fromInitiativeId: e.fromInitiativeId, toInitiativeId: e.toInitiativeId }));
  const { blockedBy, criticalPath, cycleDetected } = computeDependencyAnalysis(depInits, depEdges);

  const onPath = new Set(criticalPath);
  // Consecutive pairs of the critical path are its edges.
  const pathPairs = new Set<string>();
  for (let i = 0; i < criticalPath.length - 1; i++) pathPairs.add(`${criticalPath[i]}→${criticalPath[i + 1]}`);

  // Per-initiative task rollup.
  const counts = new Map<string, { total: number; done: number }>();
  for (const t of taskRows) {
    if (!t.initiativeId) continue;
    const c = counts.get(t.initiativeId) ?? { total: 0, done: 0 };
    c.total += 1;
    if (DONE_TASK_STATUSES.has(t.status)) c.done += 1;
    counts.set(t.initiativeId, c);
  }

  const nodes: ValueStreamInitiative[] = inits.map((i) => {
    const c = counts.get(i.id) ?? { total: 0, done: 0 };
    return {
      id: i.id,
      name: i.name,
      status: i.status,
      onCriticalPath: onPath.has(i.id),
      blockedBy: blockedBy[i.id] ?? [],
      totalTasks: c.total,
      completedTasks: c.done,
      completionPct: c.total > 0 ? Math.round((c.done / c.total) * 100) : 0,
    };
  });

  const outEdges: ValueStreamEdge[] = edges.map((e) => ({
    id: e.id,
    fromInitiativeId: e.fromInitiativeId,
    toInitiativeId: e.toInitiativeId,
    onCriticalPath: pathPairs.has(`${e.fromInitiativeId}→${e.toInitiativeId}`),
  }));

  return { nodes, edges: outEdges, criticalPath, cycleDetected };
}

/** Thin DB shell: three bounded queries (initiatives, dependency edges, tasks),
 *  then the pure assembly. Segment-scoped like the dependency CRUD. */
export async function computeValueStream(db: Db, tenantId: number, segmentId: string): Promise<ValueStream> {
  const inits = (await db
    .select({ id: initiatives.id, name: initiatives.name, status: initiatives.status })
    .from(initiatives)
    .where(and(eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, segmentId)))) as VsInitiativeRow[];

  if (inits.length === 0) return { nodes: [], edges: [], criticalPath: [], cycleDetected: false };

  const edges = (await db
    .select({ id: pmoDependencies.id, fromInitiativeId: pmoDependencies.fromInitiativeId, toInitiativeId: pmoDependencies.toInitiativeId })
    .from(pmoDependencies)
    .where(and(eq(pmoDependencies.tenantId, tenantId), eq(pmoDependencies.segmentId, segmentId)))) as VsEdgeRow[];

  // Effective initiative per task = task.initiativeId ?? project.initiativeId.
  const taskRows = (await db
    .select({ direct: tasks.initiativeId, viaProject: projects.initiativeId, status: tasks.status })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(projects.tenantId, tenantId), eq(tasks.archived, false)))
    .limit(MAX_TASK_ROWS))
    .map((r) => ({ initiativeId: (r.direct ?? r.viaProject) as string, status: r.status }))
    .filter((r) => r.initiativeId != null) as VsTaskRow[];

  return buildValueStream(inits, edges, taskRows);
}
