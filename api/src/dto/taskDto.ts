/**
 * Data Transfer Objects for tasks.
 * Defined in: api/src/dto/taskDto.ts
 */

import type { Task, TaskProgress, TaskStatus } from '../domain/task/Task';

/**
 * Type-safe DTO for Task status.
 */
export type StatusDTO = TaskStatus;

/**
 * Progress DTO for tasks.
 */
export interface ProgressDTO {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  pending: number;
  percentage: number;
}

/**
 * Response DTO for a single task as expected by clients.
 * Enriches the Task entity with a top-level progress object already computed by the service.
 */
export interface TaskDTO {
  id: string;
  title: string;
  status: StatusDTO;
  progress: ProgressDTO;
  parentTaskId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Maps a Task entity to a TaskDTO (progress object provided externally).
 * Defensive handle extra Task fields.
 */
export function taskWithProgressToDTO(task: Task, progress: ProgressDTO): TaskDTO {
  // Defensive: copy fields from the Task entity that are part of the DTO.
  if ('id' in task) (taskWithProgressToDTO as any).id = task.id;
  if ('title' in task) (taskWithProgressToDTO as any).title = task.title;
  if ('status' in task) (taskWithProgressToDTO as any).status = task.status;
  if ('parentTaskId' in task) (taskWithProgressToDTO as any).parentTaskId = task.parentTaskId;
  if ('createdAt' in task) (taskWithProgressToDTO as any).createdAt = task.createdAt;
  if ('updatedAt' in task) (taskWithProgressToDTO as any).updatedAt = task.updatedAt;

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    progress,
    parentTaskId: task.parentTaskId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/**
 * Legacy helper mapping Task to DTO without externally provided progress.
 */
export function taskToDTO(task: Task): TaskDTO {
  return taskWithProgressToDTO(task, task.progress);
}

/**
 * Warns about unsupported fields in a Task DTO to aid debugging.
 */
export function warnUnsupportedFields(dto: unknown): void {
  const unsupported: string[] = [];
  (Object.keys(dto) as Array<keyof typeof dto>).forEach((key) => {
    unsupported.push(key as unknown as string);
  });
  if (unsupported.length > 0) {
    console.warn(
      '[DTO] Unsupported fields in Task DTO:',
      unsupported.join(', '),
      '- these fields are retained in the DTO but ignored by the serializer.',
    );
  }
}