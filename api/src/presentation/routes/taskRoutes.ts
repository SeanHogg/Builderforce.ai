import { Hono } from 'hono';
import { TaskService } from '../../application/task/TaskService';
import { TaskPriority, AgentType, TaskStatus } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import { auditEvents } from '../../infrastructure/database/schema';
import { AuditEventType } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';

export function createTaskRoutes(taskService: TaskService, db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/tasks?project_id=1
  router.get('/', async (c) => {
    const projectIdParam = c.req.query('project_id');
    const projectId = projectIdParam ? Number(projectIdParam) : undefined;
    const tasks = await taskService.listTasks(c.get('tenantId'), projectId);
    return c.json({ tasks: tasks.map(t => t.toPlain()) });
  });

  // GET /api/tasks/:id
  router.get('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const task = await taskService.getTask(id);
    return c.json(task.toPlain());
  });

  // POST /api/tasks
  router.post('/', async (c) => {
    const body = await c.req.json<{
      projectId: number;
      title: string;
      description?: string | null;
      priority?: TaskPriority;
      assignedAgentType?: AgentType | null;
      assignedClawId?: number | null;
      startDate?: string | null;
      dueDate?: string | null;
      persona?: string | null;
    }>();
    const task = await taskService.createTask(body, c.get('tenantId'));
    return c.json(task.toPlain(), 201);
  });

  // PATCH /api/tasks/:id
  router.patch('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<{
      title?: string;
      description?: string | null;
      status?: TaskStatus;
      priority?: TaskPriority;
      assignedAgentType?: AgentType | null;
      assignedClawId?: number | null;
      githubPrUrl?: string | null;
      githubPrNumber?: number | null;
      startDate?: string | null;
      dueDate?: string | null;
      persona?: string | null;
      archived?: boolean;
    }>();
    const task = await taskService.updateTask(id, body);

    // record audit event for the status of this task change
    try {
      await db.insert(auditEvents).values({
        tenantId: c.get('tenantId'),
        userId:   (c as any).get('userId') ?? null,
        eventType: AuditEventType.TASK_UPDATED,
        resourceType: 'task',
        resourceId: String(id),
        metadata: JSON.stringify(body),
      });
    } catch {
      // ignore failures to avoid blocking the main flow
    }

    return c.json(task.toPlain());
  });

  // DELETE /api/tasks/:id
  router.delete('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    await taskService.deleteTask(id);
    return c.body(null, 204);
  });

  // POST /api/tasks/next
  // Atomically claim the next ready task in this tenant's workspace and
  // transition it to in_progress. Returns the task or null if none available.
  router.post('/next', async (c) => {
    const task = await taskService.dequeueNextReady(c.get('tenantId'));
    if (task) {
      // record that the task was claimed
      try {
        await db.insert(auditEvents).values({
          tenantId: c.get('tenantId'),
          userId: null,
          eventType: AuditEventType.TASK_UPDATED,
          resourceType: 'task',
          resourceId: String(task.id),
          metadata: JSON.stringify({ claimed: true, status: task.status }),
        });
      } catch {
        // ignore errors
      }
    }
    return c.json({ task: task ? task.toPlain() : null });
  });

  return router;
}
