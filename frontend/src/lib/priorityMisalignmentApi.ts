/**
 * Priority Misalignment API Client
 * Provides typed methods for interacting with the priority misalignment backend
 */

import { apiRequest } from './apiClient';

export interface MisalignmentRule {
  id: string;
  projectId: number | null;
  type: 'hierarchical' | 'strategic' | 'dependency';
  enabled: boolean;
  severity: 'warning' | 'error';
  threshold: number;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MisalignmentCheck {
  taskId: number;
  ruleId: string;
  type: 'hierarchical' | 'strategic' | 'dependency';
  severity: 'warning' | 'error';
  detachedReason?: string;
  details: {
    reason: string;
    parentPriority?: string;
    childPriority: string;
    deviation: number;
    expected?: string;
    actionableHint?: string;
  };
  createdAt: Date;
}

export interface TaskMisalignmentState {
  taskId: number;
  hasMisalignment: boolean;
  ruleIds: string[];
  totalSeverity: 'warning' | 'error';
  issues: MisalignmentCheck[];
}

export interface CheckTasksResult {
  results: Array<{
    taskId: number;
    taskTitle: string;
    taskPriority: string;
    checks: MisalignmentCheck[];
    totalSeverity: 'warning' | 'error';
    count: number;
  }>;
  summary: {
    totalTasks: number;
    totalChecks: number;
  };
}

/**
 * Get all misalignment rules
 */
export function getMisalignmentRules(): Promise<{ rules: MisalignmentRule[]; count: number }> {
  return apiRequest('/api/misalignment-rules/rules');
}

/**
 * Create a new misalignment rule
 */
export function createMisalignmentRule(
  data: {
    type: 'hierarchical' | 'strategic' | 'dependency';
    description: string;
    projectId?: number | null;
    enabled?: boolean;
    severity?: 'warning' | 'error';
    threshold?: number;
  }
): Promise<{ rule: MisalignmentRule }> {
  return apiRequest('/api/misalignment-rules/rules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Update a misalignment rule
 */
export function updateMisalignmentRule(
  ruleId: string,
  data: {
    enabled?: boolean;
    threshold?: number;
    description?: string;
  }
): Promise<{ rule: MisalignmentRule }> {
  return apiRequest(`/api/misalignment-rules/rules/${ruleId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Delete a misalignment rule
 */
export function deleteMisalignmentRule(ruleId: string): Promise<{ success: true }> {
  return apiRequest(`/api/misalignment-rules/rules/${ruleId}`, {
    method: 'DELETE',
  });
}

/**
 * Get misalignment checks for a specific task
 */
export function getTaskMisalignmentChecks(taskId: number): Promise<{
  checks: MisalignmentCheck[];
  totalSeverity: 'warning' | 'error';
  count: number;
}> {
  return apiRequest(`/api/misalignment-rules/tasks/${taskId}/checks`);
}

/**
 * Get aggregated misalignment state for a task
 */
export function getTaskMisalignmentState(taskId: number): Promise<TaskMisalignmentState> {
  return apiRequest(`/api/misalignment-rules/tasks/${taskId}/state`);
}

/**
 * Check multiple tasks for misalignments
 */
export function checkMultipleTasks(
  data: { taskIds: number[]; projectId?: number }
): Promise<CheckTasksResult> {
  return apiRequest('/api/misalignment-rules/check', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Refresh task misalignment state (useful for manual refresh)
 */
export function refreshTaskMisalignmentState(taskId: number): Promise<TaskMisalignmentState> {
  // Reuse state endpoint, assuming backend caches ops
  return getTaskMisalignmentState(taskId);
}