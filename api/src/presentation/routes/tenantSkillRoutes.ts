/**
 * `/api/workspace-skills` — the workspace's own skills and their review queue.
 * Distinct from `/api/skills` (skills reported by legacy registered agents), the
 * published marketplace catalogue (`/marketplace/skills`, `/api/v1/skills`) and
 * marketplace skill ASSIGNMENTS (`/api/skill-assignments`): these are skills the
 * workspace itself authored, with a review state.
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
  listSkillsWithFiles,
  reviewSkill,
  type TenantSkillStatus,
} from '../../application/skills/tenantSkillService';
import { exportWorkspaceSkill, importWorkspaceSkill } from '../../application/skills/skillPortability';
import { SkillFolderFiles } from './skillFolderSchema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

const STATUSES: readonly TenantSkillStatus[] = ['draft', 'approved', 'rejected'];

/** A skill id is a uuid; anything else is a skill that does not exist, not a 500. */
const skillId = z.string().uuid();
const NOT_FOUND = { error: 'Skill not found' } as const;

/** An Agent Skills folder (`SkillFolderFiles`) plus where it lands and how. */
const importSchema = z.object({
  files: SkillFolderFiles,
  projectId: z.number().int().positive().nullable().optional(),
  // `create` (writing a new skill) refuses a name already in use; `replace` ships the next version.
  mode: z.enum(['create', 'replace']).optional(),
});

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
    return c.json({ skills: await listSkillsWithFiles(db, c.get('tenantId'), status) });
  });

  // POST /api/workspace-skills/import — bring in an Agent Skills folder. MANAGER, like a
  // review: the importer signs the skill off, so it is binding the moment it lands.
  router.post('/import', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, importSchema);
    const r = await importWorkspaceSkill(c.env as Env, db, c.get('tenantId'), {
      files: body.files,
      projectId: body.projectId ?? null,
      userId: c.get('userId'),
      mode: body.mode,
    });
    if (!r.ok && r.conflict) return c.json({ error: 'A skill with this name already exists', code: 'skill_name_taken', details: { issues: r.issues } }, 409);
    if (!r.ok) return c.json({ error: 'This folder is not a valid Agent Skill', details: { issues: r.issues } }, 422);
    return c.json({ skill: r.skill, outcome: r.outcome, issues: r.issues }, r.outcome === 'created' ? 201 : 200);
  });

  // GET /api/workspace-skills/:id/export — the skill as a spec folder (SKILL.md first).
  // Member-level, like the list: anyone who may read the skill may take it elsewhere.
  router.get('/:id/export', async (c) => {
    const id = skillId.safeParse(c.req.param('id'));
    if (!id.success) return c.json(NOT_FOUND, 404);
    const folder = await exportWorkspaceSkill(c.env as Env, db, c.get('tenantId'), id.data);
    if (!folder) return c.json(NOT_FOUND, 404);
    return c.json(folder);
  });

  // POST /api/workspace-skills/:id/review — the ONLY way a skill becomes binding.
  router.post('/:id/review', requireRole(TenantRole.MANAGER), async (c) => {
    const id = skillId.safeParse(c.req.param('id'));
    if (!id.success) return c.json(NOT_FOUND, 404);
    const body = await parseBody(c, reviewSchema);
    const r = await reviewSkill(c.env as Env, db, c.get('tenantId'), id.data, body.decision, {
      userId: c.get('userId'),
      ...(body.note ? { note: body.note } : {}),
    });
    if (!r.ok) return c.json({ error: r.error ?? 'Skill not found' }, 404);
    return c.json({ skill: r.skill });
  });

  // DELETE /api/workspace-skills/:id — purge a draft nobody wants kept.
  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const id = skillId.safeParse(c.req.param('id'));
    if (!id.success) return c.json(NOT_FOUND, 404);
    const removed = await deleteSkill(c.env as Env, db, c.get('tenantId'), id.data);
    if (!removed) return c.json(NOT_FOUND, 404);
    return c.json({ ok: true });
  });

  return router;
}
