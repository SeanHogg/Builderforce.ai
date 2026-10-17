/**
 * THE DASHBOARD'S TALLIES — counts, never lists.
 *
 * Server counterparts: `GET /api/tasks/counts` (`application/task/taskCounts.ts`) and
 * `GET /api/approvals/count` (`application/approval/pendingApprovalCount.ts`). Both are
 * one cached aggregate. The dashboard used to download the whole task list (unbounded,
 * enriched) and every approval just to show three numbers and a badge. Any surface that
 * shows only a count reads it from here, not from `tasksApi.list()` /
 * `approvalsApi.list()`.
 */
import { apiRequest } from './apiClient';

/** `GET /api/tasks/counts`. Tasks older than the window = `total - recentCreatedAt.length`. */
export interface TaskCounts {
  total: number;
  inProgress: number;
  done: number;
  /** `createdAt` of tasks from the trailing 15 days, for the sparkline. */
  recentCreatedAt: string[];
}

/** `GET /api/approvals/count` — the viewer's visible pending approvals. */
export interface PendingApprovalCount {
  pending: number;
  recentCreatedAt: string[];
}

export function fetchTaskCounts(projectId?: number): Promise<TaskCounts> {
  return apiRequest<TaskCounts>(`/api/tasks/counts${projectId != null ? `?project_id=${projectId}` : ''}`);
}

export function fetchPendingApprovalCount(): Promise<PendingApprovalCount> {
  return apiRequest<PendingApprovalCount>('/api/approvals/count');
}
