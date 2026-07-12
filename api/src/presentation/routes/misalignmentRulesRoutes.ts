import { Hono, type Context } from 'hono';
import { PriorityMisalignmentCheckService } from '../../application/priorityMisalignment/priorityMisalignmentCheck.service';
import { PriorityMisalignmentInfrastructureService } from '../../application/priorityMisalignment/priorityMisalignmentInfrastructure.service';
import { type GetOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { authMiddleware } from '../middleware/authMiddleware';
import { projects } from '../../infrastructure/database/schema';
import { db } from '../../infrastructure/database/connection';
import { eq } from 'drizzle-orm';

/**
 * Priority Misalignment Rules API Routes
 *
 * Manages misalignment detection rules and performs task-level checks.
 */

const routes = new Hono<{ Variables: { userId: string }, Bindings: any }>();

// Initialize service instances
let checkService: PriorityMisalignmentCheckService;
let infraService: PriorityMisalignmentInfrastructureService;

routes.use('*', async (c, next) => {
  if (!checkService) {
    checkService = new PriorityMisalignmentCheckService(db);
  }
  if (!infraService) {
    infraService = new PriorityMisalignmentInfrastructureService(db);
  }
  await next();
});

/* guard against circular dependency staging by importing locally */
type CheckTTLCache = Map<number, boolean>;

routes.get('/rules', authMiddleware, async (c) => {
  try {
    const rules = await db.query.misalignment_rules.findMany({ orderBy: { created_at: 'asc' } });
    return c.json({ rules, count: rules.length });
  } catch (e) {
    console.error('Error fetching misalignment rules:', e);
    return c.json({ error: 'Failed to fetch rules' }, 500);
  }
});

routes.post('/rules', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    if (!body.type || !body.description) {
      return c.json({ error: 'Missing required fields' }, 400);
    }
    if (!['hierarchical', 'strategic', 'dependency'].includes(body.type)) {
      return c.json({ error: 'Invalid rule type' }, 400);
    }
    const ruleId = `rule_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const newRule = await db.query.misalignment_rules.create({
      data: {
        id: ruleId,
        project_id: body.projectId ?? null,
        rule_type: body.type,
        enabled: body.enabled ?? false,
        severity: body.severity ?? 'warning',
        threshold: body.threshold ?? 1,
        description: body.description,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    bumpCacheVersion('priority_misalignment');
    return c.json({ rule: newRule }, 201);
  } catch (e) {
    console.error('Error creating misalignment rule:', e);
    return c.json({ error: 'Failed to create rule' }, 500);
  }
});

routes.patch('/rules/:ruleId', authMiddleware, async (c) => {
  try {
    const ruleId = c.req.param('ruleId');
    const body = await c.req.json();
    const updateData: any = { updated_at: new Date() };
    if (body.enabled !== undefined) updateData.enabled = body.enabled;
    if (body.threshold !== undefined) updateData.threshold = body.threshold;
    if (body.description !== undefined) updateData.description = body.description;
    const rule = await db.query.misalignment_rules.update({ where: { id: ruleId }, data: updateData });
    if (!rule) return c.json({ error: 'Rule not found' }, 404);
    bumpCacheVersion('priority_misalignment');
    return c.json({ rule });
  } catch (e) {
    console.error('Error updating misalignment rule:', e);
    return c.json({ error: 'Failed to update rule' }, 500);
  }
});

routes.delete('/rules/:ruleId', authMiddleware, async (c) => {
  try {
    const ruleId = c.req.param('ruleId');
    await db.query.misalignment_rules.delete({ where: { id: ruleId } });
    bumpCacheVersion('priority_misalignment');
    return c.json({ success: true });
  } catch (e) {
    console.error('Error deleting misalignment rule:', e);
    return c.json({ error: 'Failed to delete rule' }, 500);
  }
});

routes.get('/tasks/:taskId/checks', authMiddleware, async (c) => {
  try {
    const taskId = parseInt(c.req.param('taskId'), 10);
    if (isNaN(taskId)) return c.json({ error: 'Invalid taskId' }, 400);
    const checks = await checkService.checkTask(taskId, null);
    return c.json({ checks: checks.checks, totalSeverity: checks.totalSeverity, count: checks.checks.length });
  } catch (e) {
    console.error('Error fetching task misalignment checks:', e);
    return c.json({ error: 'Failed to fetch checks' }, 500);
  }
});

routes.get('/tasks/:taskId/state', authMiddleware, async (c) => {
  try {
    const taskId = parseInt(c.req.param('taskId'), 10);
    if (isNaN(taskId)) return c.json({ error: 'Invalid taskId' }, 400);
    const state = await checkService.getTaskMisalignmentState(taskId);
    return c.json(state);
  } catch (e) {
    console.error('Error fetching task misalignment state:', e);
    return c.json({ error: 'Failed to fetch state' }, 500);
  }
});

routes.post('/check', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { taskIds, projectId } = body;
    if (!taskIds || !Array.isArray(taskIds)) {
      return c.json({ error: 'taskIds must be a non-empty array' }, 400);
    }
    const tasks = await db.query.tasks.findMany({ where: { id: { in: taskIds.map((id: number) => Number(id)) } } });
    if (tasks.length !== taskIds.length) {
      return c.json({ error: 'One or more task IDs not found' }, 422);
    }
    const results = [];
    for (const task of tasks) {
      const result = await checkService.checkTask(Number(task.id), Number(projectId) || null);
      results.push({
        taskId: task.id,
        taskTitle: task.title,
        taskPriority: task.priority,
        checks: result.checks,
        totalSeverity: result.totalSeverity,
        count: result.checks.length,
      });
    }
    bumpCacheVersion('priority_misalignment');
    return c.json({ results, summary: { totalTasks: taskIds.length, totalChecks: results.reduce((sum, r) => sum + r.count, 0) } });
  } catch (e) {
    console.error('Error performing misalignment checks:', e);
    return c.json({ error: 'Failed to perform checks' }, 500);
  }
});

export default routes;