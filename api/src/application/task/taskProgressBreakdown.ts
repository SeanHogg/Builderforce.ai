import { isDoneStatus } from '../../domain/shared/doneClass';

export type TaskProgressBasis = 'subtasks' | 'pr' | 'status' | 'manual';
export type TaskProgressPrState = 'none' | 'draft' | 'open' | 'merged' | 'closed';

export interface TaskProgressBreakdown {
  basis: TaskProgressBasis;
  progressPct: number;
  subtasksDone: number;
  subtasksTotal: number;
  codeDelivered: boolean;
  testsPassing: boolean | null;
  prState: TaskProgressPrState;
}

const STATUS_PROGRESS: Readonly<Record<string, number>> = {
  backlog: 0,
  todo: 0,
  ready: 10,
  in_progress: 50,
  in_review: 75,
};

export function normalizeTaskPrState(status: string | null | undefined): TaskProgressPrState {
  return status === 'draft' || status === 'open' || status === 'merged' || status === 'closed'
    ? status
    : 'none';
}

/** Explain progress from durable evidence. A PR row alone is never completion. */
export function buildTaskProgressBreakdown(input: {
  status: string | null | undefined;
  childStatuses?: readonly string[];
  codeDelivered?: boolean;
  prStatus?: string | null;
  buildStatus?: string | null;
}): TaskProgressBreakdown {
  const children = input.childStatuses ?? [];
  const subtasksDone = children.filter(isDoneStatus).length;
  const subtasksTotal = children.length;
  const codeDelivered = input.codeDelivered === true;
  const prState = normalizeTaskPrState(input.prStatus);
  const testsPassing = input.buildStatus === 'success' ? true : input.buildStatus === 'failure' ? false : null;
  const shared = { subtasksDone, subtasksTotal, codeDelivered, testsPassing, prState };

  if (subtasksTotal > 0) {
    return { basis: 'subtasks', progressPct: Math.round((subtasksDone / subtasksTotal) * 100), ...shared };
  }
  if (isDoneStatus(input.status)) return { basis: 'status', progressPct: 100, ...shared };
  if (codeDelivered && (prState === 'merged' || prState === 'closed')) {
    return { basis: 'pr', progressPct: 100, ...shared };
  }
  if (codeDelivered && (prState === 'open' || prState === 'draft')) {
    return { basis: 'pr', progressPct: 75, ...shared };
  }

  const known = STATUS_PROGRESS[input.status ?? ''];
  return { basis: known == null ? 'manual' : 'status', progressPct: known ?? 0, ...shared };
}
