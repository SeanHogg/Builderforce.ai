/**
 * Member persona routes — /api/member-personas
 *
 * The LATERAL "lens persona" dimension of the 2D RBAC (see personaLens.ts). A
 * persona (ceo|cfo|cto|ciso|pmo|em|ic) reorders / highlights insight lenses for
 * the organizational role a user plays; it is NEVER an access grant (every lens
 * stays role-gated by requireRole on /api/insights/*). This route owns the
 * persona ASSIGNMENT, not enforcement.
 *
 *   GET  /api/member-personas            my personas + defaults; roster (MANAGER+)
 *   PUT  /api/member-personas            self-set my personas + primary
 *   POST /api/member-personas/assign     manager assigns a user's personas (MANAGER+)
 *
 * The rows, the "exactly one primary" invariant and the response shaping live in
 * `application/rbac/memberPersonaService.ts`.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import { PERSONAS } from '../../application/rbac/personaLens';
import {
  assignPersonas, readPersonas, readPersonaRoster, shapePersonas,
} from '../../application/rbac/memberPersonaService';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

interface PersonaBody {
  personas?: string[];
  primary?: string | null;
}

export function createMemberPersonaRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── GET / — my personas (+ defaults); managers also get the tenant roster ──
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const role = c.get('role') as TenantRole;

    const body: Record<string, unknown> = {
      available: PERSONAS,
      ...shapePersonas(await readPersonas(db, tenantId, userId)),
    };

    // Manager-sees-all: the tenant roster's personas (for the assignment UI).
    if (hasMinRole(role, TenantRole.MANAGER)) {
      body.roster = await readPersonaRoster(db, tenantId);
    }

    return c.json(body);
  });

  // ── PUT / — self-set my personas + primary ────────────────────────────────
  router.put('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const raw = await c.req.json<PersonaBody>().catch(() => ({} as PersonaBody));
    return c.json(await assignPersonas(db, tenantId, userId, raw.personas, raw.primary));
  });

  // ── POST /assign — manager assigns a user's personas ──────────────────────
  router.post('/assign', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const raw = await c.req.json<PersonaBody & { userId?: string }>().catch(() => ({} as PersonaBody & { userId?: string }));
    const targetUserId = raw.userId;
    if (!targetUserId) return c.json({ error: 'userId is required' }, 400);
    const result = await assignPersonas(db, tenantId, targetUserId, raw.personas, raw.primary);
    return c.json({ userId: targetUserId, ...result });
  });

  return router;
}
