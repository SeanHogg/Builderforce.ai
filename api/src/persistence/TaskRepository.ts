import type { TaskStatus } from '../domain/task/TaskStatus';

/**
 * DTO for querying tasks.
 */
export interface SearchParams {
  status?: TaskStatus[];
  titleContains?: string;
  parentTaskId?: string;
  projectId?: string;
  includeArchived?: boolean;
  offset?: number;
  limit?: number;
}

export interface GetByProjectInput {
  projectId: string;
  includeArchived?: boolean;
}

export interface UpdateInput {
  id: string;
  title?: string;
  status?: TaskStatus;
  parentTaskId?: string;
  description?: string;
  projectId?: string;
  progress?: { total: number; completed: number; failed: number; skipped: number };
}

export interface SaveInput {
  title: string;
  status: TaskStatus;
  parentTaskId: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RemoveInput {
  id: string;
}

/**
 * Task persistence interface.
 */
export interface ITaskRepository {
  save(input: SaveInput): Promise<{ id: string; title: string }>;
  getById(id: string): Promise<Task | null>;
  update(input: UpdateInput): Promise<Task | null>;
  search(params: SearchParams): Promise<Task[]>;
  delete(input: RemoveInput): Promise<boolean>;
  findByProjectIds(projectIds: string[], options?: { includeArchived?: boolean }): Promise<Task[]>;
}

/**
 * Minimal interface for drive vs in-memory reimplementation in BE—pushes ResponseEntity shape to business layer in Test-Driven style.
 */

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  pending: number;
  percentage: number;
}