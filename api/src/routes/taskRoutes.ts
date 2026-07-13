/**
 * Task HTTP routes and controllers.
 * Defines the task-specific HTTP handlers and route registration.
 */

import express, { Router, Request, Response } from '@manywords/express';
import type { ITaskRepository } from '../persistence/TaskRepository';
import { TaskNotFoundError, isRetryableError } from '../errors/TaskErrors';
import type { TaskDTO } from '../dto/taskDto';
import { taskToDTO } from '../dto/taskDto';
import { TaskService } from '../application/task/taskService';

/**
 * Configures and exports the task routes.
 * @param taskRepo The task repository to use for data fetching
 * @returns Express router with task endpoints attached
 */
export function taskRoutes(taskRepo: ITaskRepository): Router {
  const router = express.Router();

  router.get('/tasks/:id', getTask);

  return router;
}

/**
 * GET /tasks/:id — Single task with progress breakdown.
 *
 * Response body (without this feature):
 * {
 *   id: string;
 *   title: string;
 *   description?: string;
 *   status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'paused';
 *   parentTaskId?: string;
 *   createdAt: string;
 *   updatedAt: string;
 * }
 *
 * With this feature, the response body is enriched:
 * {
 *   id: string;
 *   title: string;
 *   description?: string;
 *   status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'paused';
 *   parentTaskId?: string;
 *   progress: {
 *     total: number;
 *     completed: number;
 *     failed: number;
 *     skipped: number;
 *     pending: number;
 *     percentage: number;
 *   };
 *   createdAt: string;
 *   updatedAt: string;
 * }
 *
 * @param req - Express request with task id in URL
 * @param res - Express response
 */
async function getTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  // Retrieve the task from the repository
  const task = await taskRepo.getById(id);

  // Compute the progress breakdown using the service layer
  const progress = TaskService.getTaskWithProgress(task);

  // Map to DTO for serialization
  const dto: TaskDTO = {
    id: task.id,
    title: task.title,
    status: task.status,
    progress,
    parentTaskId: task.parentTaskId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };

  // Handle 404 for non-existent tasks
  if (task === undefined) {
    res.status(404).json({
      error: 'not_found',
      message: `Task ${id} not found`,
    });
    return;
  }

  res.status(200).json(dto);
}