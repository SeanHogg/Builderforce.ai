import { effectiveTicketProgress, isClosedTaskStatus } from '@builderforce/agent-loop';

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
  // A cancelled subtask is owed nothing, so it counts toward done like a finished one.
  const subtasksDone = children.filter(isClosedTaskStatus).length;
  const subtasksTotal = children.length;
  const codeDelivered = input.codeDelivered === true;
  const prState = normalizeTaskPrState(input.prStatus);
  const testsPassing = input.buildStatus === 'success' ? true : input.buildStatus === 'failure' ? false : null;
  const shared = { subtasksDone, subtasksTotal, codeDelivered, testsPassing, prState };

  // Every figure passes through the shared task-tier rule (agent-loop
  // `effectiveTicketProgress`): a closed lane (done OR cancelled) reads 100 whatever its
  // children say, and an OPEN lane never reads 100 — all subtasks closed or a merged PR
  // reads the claimed-complete rung until the lane itself closes.
  const at = (basis: TaskProgressBasis, raw: number): TaskProgressBreakdown =>
    ({ basis, progressPct: effectiveTicketProgress(input.status, raw), ...shared });

  if (isClosedTaskStatus(input.status)) return at('status', 100);
  if (subtasksTotal > 0) return at('subtasks', Math.round((subtasksDone / subtasksTotal) * 100));
  if (codeDelivered && (prState === 'merged' || prState === 'closed')) return at('pr', 100);
  if (codeDelivered && (prState === 'open' || prState === 'draft')) return at('pr', 75);

  const known = STATUS_PROGRESS[input.status ?? ''];
  return at(known == null ? 'manual' : 'status', known ?? 0);
}
