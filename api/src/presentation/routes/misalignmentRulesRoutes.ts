import { Hono, type Context } from 'hono';
import { PriorityMisalignmentCheckService } from '../../application/priorityMisalignment/priorityMisalignmentCheck.service';
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

// Initialize service (shared across middleware/requests)
let checkService: PriorityMisalignmentCheckService;

/**
 * Middleware to initialize the check service
 */
routes.use('*', async (c, next) => {
  if (!checkService) {
    const service = new PriorityMisalignmentCheckService(db);
    if (c.env) {
      // Attach read-through cache to service for task checks
      c.env.CHECK_CACHE_SERVICE = service;
    }
    checkService = service;
  }
  await next();
});

/**
 * GET /api/priority-misalignment/rules
 * List all misalignment rules (project-scoped or workspace-wide)
 */
routes.get('/rules', authMiddleware, async (c) => {
  try {
    const tenantId = c.get('userId');
    // TODO: Query by tenant from tenant_members once schema supports role filtering
    const rules = await db.query.misalignment_rules.findMany({
      orderBy: { created_at: 'asc' },
    });

    // TODO: Filter rules by project membership via tenant_members/tenant_roles
    return c.json({ rules, count: rules.length });
  } catch (error) {
    console.error('Error fetching misalignment rules:', error);
    return c.json({ error: 'Failed to fetch rules' }, 500);
  }
});

/**
 * POST /api/priority-misalignment/rules
 * Create a new misalignment rule
 */
routes.post('/rules', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();

    // Validate required fields
    if (!body.type || !body.description) {
      return c.json({ error: 'Missing required fields: type, description' }, 400);
    }

    // Validate rule type
    const validTypes = ['hierarchical', 'strategic', 'dependency'];
    if (!validTypes.includes(body.type)) {
      return c.json({ error: `Invalid rule type. Must be one of: ${validTypes.join(', ')}` }, 400);
    }

    // Generate unique ID
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

    // TODO: Invalidate any relevant caches (e.g., project scope)
    bumpCacheVersion('priority_misalignment');

    return c.json({ rule: newRule }, 201);
  } catch (error: any) {
    console.error('Error creating misalignment rule:', error);
    if (error.code === 'P2002') {
      return c.json({ error: `Rule with id ${error.meta?.target} already exists` }, 409);
    }
    return c.json({ error: 'Failed to create rule' }, 500);
  }
});

/**
 * GET /api/priority-misalignment/rules/:ruleId
 * Get a specific rule by ID
 */
routes.get('/rules/:ruleId', authMiddleware, async (c) => {
  try {
    const ruleId = c.req.param('ruleId');
    const rule = await db.query.misalignment_rules.findFirst({
      where: { id: ruleId },
    });

    if (!rule) {
      return c.json({ error: 'Rule not found' }, 404);
    }

    return c.json({ rule });
  } catch (error) {
    console.error('Error fetching misalignment rule:', error);
    return c.json({ error: 'Failed to fetch rule' }, 500);
  }
});

/**
 * PATCH /api/priority-misalignment/rules/:ruleId
 * Update a rule (enable/disable, threshold, description)
 */
routes.patch('/rules/:ruleId', authMiddleware, async (c) => {
  try {
    const ruleId = c.req.param('ruleId');
    const body = await c.req.json();

    const updateData: any = {
      updated_at: new Date(),
    };

    if (body.enabled !== undefined) {
      updateData.enabled = body.enabled;
    }
    if (body.threshold !== undefined) {
      updateData.threshold = body.threshold;
    }
    if (body.description !== undefined) {
      updateData.description = body.description;
    }

    const rule = await db.query.misalignment_rules.update({
      where: { id: ruleId },
      data: updateData,
    });

    if (!rule) {
      return c.json({ error: 'Rule not found' }, 404);
    }

    bumpCacheVersion('priority_misalignment');

    return c.json({ rule });
  } catch (error: any) {
    console.error('Error updating misalignment rule:', error);
    return c.json({ error: 'Failed to update rule' }, 500);
  }
});

/**
 * DELETE /api/priority-misalignment/rules/:ruleId
 * Delete a rule
 */
routes.delete('/rules/:ruleId', authMiddleware, async (c) => {
  try {
    const ruleId = c.req.param('ruleId');

    // Check if rule is used (optional - can be implemented)
    await db.query.misalignment_rules.delete({
      where: { id: ruleId },
    });

    bumpCacheVersion('priority_misalignment');

    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting misalignment rule:', error);
    return c.json({ error: 'Failed to delete rule' }, 500);
  }
});

/**
 * GET /api/priority-misalignment/tasks/:taskId/checks
 * Get all misalignment checks for a specific task
 */
routes.get('/tasks/:taskId/checks', authMiddleware, async (c) => {
  try {
    const taskId = c.req.param('taskId');
    const taskIdNum = parseInt(taskId, 10);

    // Require numeric task ID
    if (isNaN(taskIdNum)) {
      return c.json({ error: 'Invalid taskId' }, 400);
    }

    // TODO: Determine project context (from path prefix, task lookup, or tenant context)
    // For now, query without project constraint
    const checks = await checkService.checkTask(taskIdNum, null);

    return c.json({ checks: checks.checks, totalSeverity: checks.totalSeverity, count: checks.checks.length });
  } catch (error) {
    console.error('Error fetching task misalignment checks:', error);
    return c.json({ error: 'Failed to fetch checks' }, 500);
  }
});

/**
 * GET /api/priority-misalignment/tasks/:taskId/state
 * Get aggregated misalignment state for a task (has misalignment? ruleIds? totalSeverity?)
 */
routes.get('/tasks/:taskId/state', authMiddleware, async (c) => {
  try {
    const taskId = c.req.param('taskId');
    const taskIdNum = parseInt(taskId, 10);

    if (isNaN(taskIdNum)) {
      return c.json({ error: 'Invalid taskId' }, 400);
    }

    const state = await checkService.getTaskMisalignmentState(taskIdNum);

    return c.json(state);
  } catch (error) {
    console.error('Error fetching task misalignment state:', error);
    return c.json({ error: 'Failed to fetch state' }, 500);
  }
});

/**
 * POST /api/priority-misalignment/check
 * Initiate a misalignment check for one or more tasks
 */
routes.post('/check', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { taskIds, projectId } = body;

    if (!taskIds || !Array.isArray(taskIds)) {
      return c.json({ error: 'taskIds must be a non-empty array' }, 400);
    }

    // Validate task IDs
    const tasks = await db.query.tasks.findMany({
      where: {
        id: { in: taskIds.map((id: number) => parseInt(id, 10)) },
      },
      take: taskIds.length,
    });

    if (tasks.length !== taskIds.length) {
      return c.json({ error: 'One or more task IDs not found' }, 422);
    }

    // Perform checks
    const results = [];
    for (const task of tasks) {
      const result = await checkService.checkTask(task.id, projectId ?? null);
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
  } catch (error) {
    console.error('Error performing misalignment checks:', error);
    return c.json({ error: 'Failed to perform checks' }, 500);
  }
});

export default routes;