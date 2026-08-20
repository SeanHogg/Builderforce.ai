/**
 * Member persona assignment — the LATERAL "lens persona" dimension of the 2D RBAC.
 *
 * A persona (ceo|cfo|cto|ciso|pmo|em|ic) reorders and highlights insight lenses
 * for the organizational role a person plays. It is NEVER an access grant: every
 * lens stays role-gated by `requireRole` on `/api/insights/*`. This module owns
 * the ASSIGNMENT — reading it, replacing it, and shaping it — and nothing about
 * enforcement, which lives in `personaLens.ts`.
 *
 * Extracted from `memberPersonaRoutes.ts` on 2026-08-19: the route held the
 * delete-then-insert write, the roster join and the response shaping, so an
 * HTTP handler was the only place the "exactly one primary" invariant was
 * expressed.
 */
import { and, eq } from 'drizzle-orm';
import { memberPersonas, users } from '../../infrastructure/database/schema';
import { isPersona, lensesFor, homeLensFor, type Persona } from './personaLens';
import type { Db } from '../../infrastructure/database/connection';

export interface PersonaAssignment {
  personas: Persona[];
  primary: Persona;
  /** The persona's highlighted lens set (view-shaping only; still role-gated). */
  lenses: ReturnType<typeof lensesFor>;
  homeLens: ReturnType<typeof homeLensFor>;
}

/** Validate + normalize an incoming persona list: dedupe, keep only known personas. */
export function normalizePersonas(raw: string[] | undefined): Persona[] {
  const set = new Set<Persona>();
  for (const p of raw ?? []) if (isPersona(p)) set.add(p);
  return [...set];
}

/** Choose the primary: the requested one if valid + present, else the first. */
export function resolvePrimary(list: Persona[], requested: string | null | undefined): Persona | null {
  if (requested && isPersona(requested) && list.includes(requested)) return requested;
  return list[0] ?? null;
}

/** Shape the API response for one user's personas. `ic` is the floor, so a member
 *  with no assignment still gets a coherent lens set rather than an empty one. */
export function shapePersonas(rows: Array<{ persona: string; isPrimary: boolean }>): PersonaAssignment {
  const personas = rows.map((r) => r.persona).filter(isPersona);
  const primary = (rows.find((r) => r.isPrimary)?.persona as Persona | undefined) ?? personas[0] ?? 'ic';
  return { personas, primary, lenses: lensesFor(primary), homeLens: homeLensFor(primary) };
}

/** One member's persona rows. */
export async function readPersonas(db: Db, tenantId: number, userId: string) {
  return db
    .select({ persona: memberPersonas.persona, isPrimary: memberPersonas.isPrimary })
    .from(memberPersonas)
    .where(and(eq(memberPersonas.tenantId, tenantId), eq(memberPersonas.userId, userId)));
}

/** The tenant roster's personas, grouped per user — the manager assignment UI. */
export async function readPersonaRoster(db: Db, tenantId: number) {
  const rows = await db
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
  for (const r of rows) {
    const u = byUser.get(r.userId) ?? { userId: r.userId, displayName: r.displayName ?? null, rows: [] };
    u.rows.push({ persona: r.persona, isPrimary: r.isPrimary });
    byUser.set(r.userId, u);
  }
  return [...byUser.values()].map((u) => ({ userId: u.userId, displayName: u.displayName, ...shapePersonas(u.rows) }));
}

/**
 * Replace a user's persona set and return the shaped result.
 *
 * Delete-then-insert, because neon-http has no interactive transaction. Exactly
 * one row is flagged primary so the partial-unique DB index holds — that is the
 * invariant this function exists to keep, and it is why no caller writes
 * `member_personas` directly.
 */
export async function assignPersonas(
  db: Db,
  tenantId: number,
  userId: string,
  requested: string[] | undefined,
  requestedPrimary: string | null | undefined,
): Promise<PersonaAssignment> {
  const list = normalizePersonas(requested);
  const primary = resolvePrimary(list, requestedPrimary);

  await db.delete(memberPersonas).where(and(eq(memberPersonas.tenantId, tenantId), eq(memberPersonas.userId, userId)));
  if (list.length > 0) {
    await db.insert(memberPersonas).values(
      list.map((persona) => ({ tenantId, userId, persona, isPrimary: persona === primary })),
    );
  }

  return shapePersonas(list.map((persona) => ({ persona, isPrimary: persona === primary })));
}
