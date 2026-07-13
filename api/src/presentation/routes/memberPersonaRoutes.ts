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
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import { memberPersonas, users } from '../../infrastructure/database/schema';
import { PERSONAS, isPersona, lensesFor, homeLensFor, type Persona } from '../../application/rbac/personaLens';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

interface PersonaBody {
  personas?: string[];
  primary?: string | null;
}

/** Validate + normalize an incoming persona list: dedupe, keep only known personas. */
function normalizePersonas(raw: string[] | undefined): Persona[] {
  const set = new Set<Persona>();
  for (const p of raw ?? []) if (isPersona(p)) set.add(p);
  return [...set];
}

/** Choose the primary: the requested one if valid + present, else the first. */
function resolvePrimary(list: Persona[], requested: string | null | undefined): Persona | null {
  if (requested && isPersona(requested) && list.includes(requested)) return requested;
  return list[0] ?? null;
}

/** Replace a user's persona set (delete-then-insert; neon-http has no interactive tx).
 *  Exactly one row is flagged primary so the partial-unique DB index holds. */
async function writePersonas(db: Db, tenantId: number, userId: string, list: Persona[], primary: Persona | null): Promise<void> {
  await db.delete(memberPersonas).where(and(eq(memberPersonas.tenantId, tenantId), eq(memberPersonas.userId, userId)));
  if (list.length === 0) return;
  await db.insert(memberPersonas).values(
    list.map((persona) => ({ tenantId, userId, persona, isPrimary: persona === primary })),
  );
}

/** Shape the API response for one user's personas. */
function shape(rows: Array<{ persona: string; isPrimary: boolean }>) {
  const personas = rows.map((r) => r.persona).filter(isPersona);
  const primary = (rows.find((r) => r.isPrimary)?.persona as Persona | undefined)
    ?? personas[0] ?? 'ic';
  return {
    personas,
    primary,
    /** The persona's highlighted lens set (view-shaping only; still role-gated). */
    lenses: lensesFor(primary),
    homeLens: homeLensFor(primary),
  };
}

export function createMemberPersonaRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── GET / — my personas (+ defaults); managers also get the tenant roster ──
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const role = c.get('role') as TenantRole;

    const mineRows = await db
      .select({ persona: memberPersonas.persona, isPrimary: memberPersonas.isPrimary })
      .from(memberPersonas)
      .where(and(eq(memberPersonas.tenantId, tenantId), eq(memberPersonas.userId, userId)));

    const body: Record<string, unknown> = { available: PERSONAS, ...shape(mineRows) };

    // Manager-sees-all: the tenant roster's personas (for the assignment UI).
    if (hasMinRole(role, TenantRole.MANAGER)) {
      const rosterRows = await db
        .select({
          userId: memberPersonas.userId,
          persona: memberPersonas.persona,
          isPrimary: memberPersonas.isPrimary,
          displayName: users.displayName,
        })
        .from(memberPersonas)
        .leftJoin(users, eq(users.id, memberPersonas.userId))
        .where(eq(memberPersonas.tenantId, tenantId));
      const byUser = new Map<string, { userId: string; displayName: string | null; rows: Array<{ persona: string; isPrimary: boolean }> }>();
      for (const r of rosterRows) {
        const u = byUser.get(r.userId) ?? { userId: r.userId, displayName: r.displayName ?? null, rows: [] };
        u.rows.push({ persona: r.persona, isPrimary: r.isPrimary });
        byUser.set(r.userId, u);
      }
      body.roster = [...byUser.values()].map((u) => ({ userId: u.userId, displayName: u.displayName, ...shape(u.rows) }));
    }

    return c.json(body);
  });

  // ── PUT / — self-set my personas + primary ────────────────────────────────
  router.put('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const raw = await c.req.json<PersonaBody>().catch(() => ({} as PersonaBody));
    const list = normalizePersonas(raw.personas);
    const primary = resolvePrimary(list, raw.primary);
    await writePersonas(db, tenantId, userId, list, primary);
    const rows = list.map((persona) => ({ persona, isPrimary: persona === primary }));
    return c.json(shape(rows));
  });

  // ── POST /assign — manager assigns a user's personas ──────────────────────
  router.post('/assign', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const raw = await c.req.json<PersonaBody & { userId?: string }>().catch(() => ({} as PersonaBody & { userId?: string }));
    const targetUserId = raw.userId;
    if (!targetUserId) return c.json({ error: 'userId is required' }, 400);
    const list = normalizePersonas(raw.personas);
    const primary = resolvePrimary(list, raw.primary);
    await writePersonas(db, tenantId, targetUserId, list, primary);
    const rows = list.map((persona) => ({ persona, isPrimary: persona === primary }));
    return c.json({ userId: targetUserId, ...shape(rows) });
  });

  return router;
}
