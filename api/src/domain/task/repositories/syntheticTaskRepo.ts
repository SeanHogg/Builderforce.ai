import type { TaskProps, Task } from '../../Task';

export type LocalTaskStore = TaskProps[];

export type CreateOneProps = Partial<TaskProps>;

export type UpdateOneProps<P> = Partial<P>;

export type Filters<P> = Partial<Record<keyof P, unknown>>;

export interface UpdateOptions<P> {
  recomputeState?: boolean;
}

export const DefaultNewTask: CreateOneProps = {
  id: 0,
  projectId: 0,
  key: 'NEW-001',
  title: 'New Task',
  description: null,
  status: 'backlog' as const,
  priority: 'medium' as const,
  taskType: 'task' as const,
  parentTaskId: null,
  assignedAgentType: null,
  githubIssueNumber: null,
  githubIssueUrl: null,
  githubPrUrl: null,
  githubPrNumber: null,
  assignedAgentHostId: null,
  assignedAgentRef: null,
  assignedUserId: null,
  gitBranch: null,
  explicitRepoId: null,
  sprintId: null,
  releaseId: null,
  storyPoints: null,
  businessValue: null,
  businessValueRationale: null,
  businessValueSource: null,
  managerRank: null,
  reviewCount: 0,
  lastReviewedAt: null,
  lastReviewVerdict: null,
  gapOriginTaskId: null,
  startDate: null,
  dueDate: null,
  persona: null,
  archived: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const DefaultFilters: Filters<TaskProps> = {};

export const LocalTaskStore = [] as LocalTaskStore;

export async function createOne(props: CreateOneProps): Promise<TaskProps> {
  return { ...DefaultNewTask, ...props } as TaskProps;
}

export async function update(
  id: number,
  props: UpdateOneProps<TaskProps>,
  options: UpdateOptions<TaskProps> = {},
): Promise<TaskProps | null> {
  const index = LocalTaskStore.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const updated = LocalTaskStore[index];
  const changes = Object.fromEntries(
    Object.entries(props).filter(([_, v]) => v !== undefined),
  );

  const merged = {
    ...updated,
    ...changes,
    updatedAt: new Date(),
  };

  LocalTaskStore[index] = merged;
  return merged;
}

export async function readMany(
  filters: Filters<TaskProps>[],
  options: UpdateOptions<TaskProps> = {},
): Promise<TaskProps[]> {
  return LocalTaskStore.filter((t) => {
    return filters.reduce((acc, f) => {
      return acc && Object.keys(f).every((k) => {
        const expected = (f as Record<string, unknown>)[k];
        return equal(expected, (t as unknown as Record<string, unknown>)[k]);
      });
    }, true);
  });
}

function equal<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined)
    return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => equal<T>(item, b[i]));
  }
  if (typeof a === 'object') {
    return Object.keys(a).every((k) => equal<T>(((a as unknown) as Record<string, T>)[k], ((b as unknown) as Record<string, T>)[k]));
  }
  return false;
}