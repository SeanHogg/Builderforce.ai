/**
 * `/api/workspace-skills` — the workspace's own skills and their review queue.
 * (`/api/skills` is the built-in catalogue's read surface and stays that.)
 *
 * Reads are member-level (a skill is an instruction every agent here follows, so
 * anyone on the workspace may see what is in force). Writes are MANAGER: approving
 * a skill changes what every agent on the workspace is told to do, which is the
 * same class of decision as editing a policy pack.
 *
 * The routes take the application service, never the table — approval has one
 * writer for a reason, and a route reaching past it would be the way that stops
 * being true.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { parseBody } from './requestBody';
import {
  deleteSkill,
  listSkills,
  reviewSkill,
  type TenantSkillStatus,
} from '../../application/skills/tenantSkillService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

const STATUSES: readonly TenantSkillStatus[] = ['draft', 'approved', 'rejected'];

/** A review is a decision plus an optional note — nothing else may be rewritten here. */
const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(1_000).optional(),
});

export function createTenantSkillRoutes(db: Db) {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/workspace-skills?status=draft — the review queue, or everything.
  router.get('/', async (c) => {
    const raw = c.req.query('status');
    const status = STATUSES.includes(raw as TenantSkillStatus) ? (raw as TenantSkillStatus) : undefined;
    return c.json({ skills: await listSkills(db, c.get('tenantId'), status) });
  });

  // POST /api/workspace-skills/:id/review — the ONLY way a skill becomes binding.
  router.post('/:id/review', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, reviewSchema);
    const r = await reviewSkill(c.env as Env, db, c.get('tenantId'), c.req.param('id'), body.decision, {
      userId: c.get('userId'),
      ...(body.note ? { note: body.note } : {}),
    });
    if (!r.ok) return c.json({ error: r.error ?? 'Skill not found' }, 404);
    return c.json({ skill: r.skill });
  });

  // DELETE /api/workspace-skills/:id — purge a draft nobody wants kept.
  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const removed = await deleteSkill(c.env as Env, db, c.get('tenantId'), c.req.param('id'));
    if (!removed) return c.json({ error: 'Skill not found' }, 404);
    return c.json({ ok: true });
  });

  return router;
}
