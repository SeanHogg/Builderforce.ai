/**
 * Common type definitions for Priority Alignment Initiative services
 */

/**
 * Task with priority and unassigned flag
 */
export interface PriorityTask {
  id: number;
  key: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  assignedUserId: null;
  status: string;
  projectId: number;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Unassigned high-priority task response from FR1
 */
export interface UnassignedHighPriorityResponse {
  tasks: PriorityTask[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  cacheInfo: {
    validForSeconds: number;
    lastUpdated: string;
  };
}

/**
 * Priority status update options
 */
export interface PriorityStatusUpdateOptions {
  taskId: number;
  status: 'on_hold' | 'deferred' | 'backlog' | 'todo' | 'ready' | 'in_progress' | 'in_review' | 'done' | 'blocked';
  note?: string;
  pushedTimestamp: string;
}