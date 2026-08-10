import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { projects } from '../../infrastructure/database/schema';
import { StakeholderMapService } from '../../application/stakeholderAlignment/StakeholderMapService';
import {
  STAKEHOLDER_ALIGNMENT_QUESTIONS,
  type StakeholderAnswer,
  type StakeholderQuestionKey,
  type StakeholderResponse,
} from '../../application/stakeholderAlignment/stakeholderAlignment.types';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { scope } from './segmentTrackerRoutes';

const RESPONSES = new Set<StakeholderResponse>(['approve', 'approve_with_comment', 'block']);
const ANSWERS = new Set<StakeholderAnswer>(['yes', 'no', 'unknown']);

function projectIdOf(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function createStakeholderAlignmentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const service = new StakeholderMapService(db);
  const manager = requireRole(TenantRole.MANAGER);
  router.use('*', authMiddleware);

  async function ownsProject(tenantId: number, projectId: number): Promise<boolean> {
    const [row] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)));
    return !!row;
  }

  router.get('/questions', (c) => c.json({ questions: STAKEHOLDER_ALIGNMENT_QUESTIONS }));

  router.get('/projects/:projectId/map', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'invalid projectId' }, 400);
    if (!await ownsProject(tenantId, projectId)) return c.json({ error: 'project not found' }, 404);
    return c.json({ stakeholders: await service.listMap(tenantId, segmentId, projectId) });
  });

  router.post('/projects/:projectId/map', manager, async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'invalid projectId' }, 400);
    if (!await ownsProject(tenantId, projectId)) return c.json({ error: 'project not found' }, 404);
    const body = await c.req.json<{
      initiativeId?: string | null;
      stakeholderRef?: string;
      displayName?: string;
      role?: string;
      teamScope?: string | null;
      priority?: string | null;
    }>();
    if (!body.stakeholderRef?.trim() || !body.displayName?.trim()) return c.json({ error: 'stakeholderRef and displayName are required' }, 400);
    if (body.role !== 'required_approver' && body.role !== 'informed') return c.json({ error: 'role must be required_approver or informed' }, 400);
    const row = await service.upsertMapEntry(tenantId, segmentId, {
      projectId, initiativeId: body.initiativeId, stakeholderRef: body.stakeholderRef,
      displayName: body.displayName, role: body.role, teamScope: body.teamScope, priority: body.priority,
    });
    return c.json(row, 201);
  });

  router.delete('/map/:id', manager, async (c) => {
    const { tenantId, segmentId } = scope(c);
    const row = await service.deactivateMapEntry(tenantId, segmentId, c.req.param('id'));
    return row ? c.json({ deactivated: row.id }) : c.json({ error: 'stakeholder not found' }, 404);
  });

  router.put('/projects/:projectId/health-profile', manager, async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'invalid projectId' }, 400);
    if (!await ownsProject(tenantId, projectId)) return c.json({ error: 'project not found' }, 404);
    const body = await c.req.json<{ answers?: Partial<Record<StakeholderQuestionKey, StakeholderAnswer>> }>();
    const keys = STAKEHOLDER_ALIGNMENT_QUESTIONS.map((question) => question.key);
    if (!body.answers || keys.some((key) => !ANSWERS.has(body.answers?.[key] as StakeholderAnswer))) {
      return c.json({ error: `answers must include ${keys.join(', ')} using yes, no, or unknown` }, 400);
    }
    const row = await service.saveHealthProfile(tenantId, segmentId, {
      projectId,
      answers: body.answers as Record<StakeholderQuestionKey, StakeholderAnswer>,
    }, c.get('userId'));
    return c.json(row);
  });

  router.get('/projects/:projectId/health-profile', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'invalid projectId' }, 400);
    if (!await ownsProject(tenantId, projectId)) return c.json({ error: 'project not found' }, 404);
    return c.json({ profile: await service.getHealthProfile(tenantId, segmentId, projectId) });
  });

  router.post('/projects/:projectId/priorities', manager, async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'invalid projectId' }, 400);
    if (!await ownsProject(tenantId, projectId)) return c.json({ error: 'project not found' }, 404);
    const body = await c.req.json<{ stakeholderRef?: string; teamScope?: string; priorityKey?: string; rationale?: string }>();
    if (!body.stakeholderRef?.trim() || !body.teamScope?.trim() || !body.priorityKey?.trim()) {
      return c.json({ error: 'stakeholderRef, teamScope, and priorityKey are required' }, 400);
    }
    return c.json(await service.submitPriority(tenantId, segmentId, projectId, {
      stakeholderRef: body.stakeholderRef, teamScope: body.teamScope, priorityKey: body.priorityKey, rationale: body.rationale,
    }), 201);
  });

  router.get('/projects/:projectId/conflicts', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'invalid projectId' }, 400);
    return c.json({ conflicts: await service.listConflicts(tenantId, segmentId, projectId, c.req.query('status') ?? 'open') });
  });

  router.post('/projects/:projectId/reviews', manager, async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'invalid projectId' }, 400);
    if (!await ownsProject(tenantId, projectId)) return c.json({ error: 'project not found' }, 404);
    const body = await c.req.json<{ subjectRef?: string; summary?: string }>();
    if (!body.subjectRef?.trim() || !body.summary?.trim()) return c.json({ error: 'subjectRef and summary are required' }, 400);
    try {
      return c.json(await service.requestSignoff(tenantId, segmentId, projectId, body.subjectRef, body.summary, c.get('userId')), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'unable to request sign-off' }, 400);
    }
  });

  router.post('/reviews/:reviewId/respond', manager, async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<{ response?: string; comment?: string }>();
    if (!RESPONSES.has(body.response as StakeholderResponse)) {
      return c.json({ error: 'a valid response is required' }, 400);
    }
    try {
      const result = await service.respondToSignoff(
        tenantId, segmentId, c.req.param('reviewId'), c.get('userId'),
        body.response as StakeholderResponse, body.comment,
      );
      return result ? c.json(result) : c.json({ error: 'review not found' }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'unable to record response' }, 400);
    }
  });

  router.get('/projects/:projectId/dashboard', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const projectId = projectIdOf(c.req.param('projectId'));
    if (!projectId) return c.json({ error: 'invalid projectId' }, 400);
    return c.json(await service.dashboard(tenantId, segmentId, projectId));
  });

  router.post('/reminders/claim', manager, async (c) => {
    const { tenantId } = scope(c);
    return c.json({ reminders: await service.claimDueReminders(tenantId) });
  });

  return router;
}
