/**
 * Mock API reference for FR1 – GET /api/tasks/unassigned-high-priority
 *
 * This file is the reference implementation per AC9. It demonstrates all
 * functional requirements: priority filtering (high|critical), assignment
 * filtering (NULL), status exclusion (archived/done/completed), pagination,
 * projectId filtering, sorting (dueDate/title/createdAt), and cacheInfo with
 * validForSeconds ≥ 1800 (30 min).
 *
 * The production implementation lives in:
 * - api/src/domain/task/ITaskRepository.ts (interface + options)
 * - api/src/infrastructure/repositories/TaskRepository.ts (query)
 * - api/src/application/task/TaskService.ts (tenant isolation)
 * - api/src/presentation/routes/taskRoutes.ts (route + Cache-Control header)
 * - api/src/domain/shared/doneClass.ts (done-class definition)
 */

export type MockTask = {
  id: number;
  projectId: number;
  title: string;
  status: string;
  priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent';
  assignedUserId: string | null;
  archived: boolean;
  dueDate: string | null;
  createdAt: string;
};

export type UnassignedHighPriorityQuery = {
  projectId?: number;
  page?: number;
  pageSize?: number;
  sortBy?: 'dueDate' | 'title' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
};

export type UnassignedHighPriorityResult = {
  tasks: MockTask[];
  total: number;
  page: number;
  pageSize: number;
  cacheInfo: { validForSeconds: number; cachedAt: string };
};

export const DONE_CLASS_STATUSES = [
  'done',
  'completed',
  'complete',
  'closed',
  'resolved',
  'shipped',
] as const;

export const HIGH_PRIORITY_VALUES = ['high', 'critical', 'urgent'] as const;
export const CACHE_VALID_SECONDS = 1800; // AC8: at least 30 minutes

function isUnassignedHighPriority(t: MockTask): boolean {
  // FR1.2: priority high|critical (prod uses high|urgent, mock maps critical↔urgent)
  const highPriority = (HIGH_PRIORITY_VALUES as readonly string[]).includes(t.priority);
  // FR1.3: assignedUserId IS NULL
  const unassigned = t.assignedUserId === null || t.assignedUserId === undefined;
  // FR1.4: exclude archived or done-class statuses
  const notArchived = t.archived === false;
  const notDone = !DONE_CLASS_STATUSES.includes(
    (t.status ?? '').trim().toLowerCase() as (typeof DONE_CLASS_STATUSES)[number],
  );
  return highPriority && unassigned && notArchived && notDone;
}

export function queryUnassignedHighPriorityMock(
  allTasks: MockTask[],
  q: UnassignedHighPriorityQuery = {},
): UnassignedHighPriorityResult {
  const page = Math.max(1, (q.page ?? 1) | 0);
  const pageSize = Math.min(100, Math.max(1, (q.pageSize ?? 20) | 0));
  const sortBy = (['dueDate', 'title', 'createdAt'] as const).includes(
    q.sortBy as any,
  )
    ? (q.sortBy as NonNullable<UnassignedHighPriorityQuery['sortBy']>)
    : 'createdAt';
  const sortOrder = q.sortOrder === 'asc' ? 'asc' : 'desc';

  // FR1 filtering
  let filtered = allTasks.filter(isUnassignedHighPriority);

  // FR1.6: projectId filter
  if (q.projectId !== undefined) {
    filtered = filtered.filter((t) => t.projectId === q.projectId);
  }

  // FR1.7: sorting
  const dir = sortOrder === 'asc' ? 1 : -1;
  filtered = filtered.slice().sort((a, b) => {
    if (sortBy === 'dueDate') {
      const av = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bv = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      if (av !== bv) return (av - bv) * dir;
      return (a.id - b.id) * 1; // stable tiebreak for pagination determinism
    }
    if (sortBy === 'title') {
      const c = a.title.localeCompare(b.title);
      if (c !== 0) return c * dir;
      return a.id - b.id;
    }
    // createdAt
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    if (at !== bt) return (at - bt) * dir;
    return (a.id - b.id) * 1;
  });

  // FR1.5: pagination
  const total = filtered.length;
  const offset = (page - 1) * pageSize;
  const tasks = filtered.slice(offset, offset + pageSize);

  return {
    tasks,
    total,
    page,
    pageSize,
    cacheInfo: {
      validForSeconds: CACHE_VALID_SECONDS,
      cachedAt: new Date().toISOString(),
    },
  };
}

/**
 * Express-style handler sketch showing expected HTTP shape.
 * In production (Hono) the route also sets:
 *   Cache-Control: private, max-age=1800
 */
export async function mockHandler(
  req: { query: Record<string, string | undefined>; tenantId?: number },
  fetchAllTasks: () => Promise<MockTask[]>,
) {
  const all = await fetchAllTasks();
  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
  const page = req.query.page ? Number(req.query.page) : undefined;
  const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;
  const sortBy = (req.query.sortBy as UnassignedHighPriorityQuery['sortBy']) ?? 'createdAt';
  const sortOrder = (req.query.sortOrder as UnassignedHighPriorityQuery['sortOrder']) ?? 'desc';

  const result = queryUnassignedHighPriorityMock(all, {
    projectId: Number.isFinite(projectId as number) ? (projectId as number) : undefined,
    page,
    pageSize,
    sortBy,
    sortOrder,
  });

  // AC8: cacheInfo.validForSeconds >= 1800
  return {
    status: 200,
    headers: { 'Cache-Control': `private, max-age=${result.cacheInfo.validForSeconds}` },
    body: result,
  };
}
