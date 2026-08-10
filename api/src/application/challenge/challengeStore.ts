/**
 * Persistence for challenges. The route layer owns HTTP; this owns the table.
 *
 * Every read and write is tenant-scoped through {@link scopedToTenant} rather
 * than by a hand-typed predicate. A challenge row carries the brief, the derived
 * plan and the id of the project it built, so an unscoped query here would hand
 * one customer another's roadmap.
 */

import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { challenges } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { ChallengeSpec } from './parseBrief';
import type { ChallengePlan } from './planChallenge';

/** The shape handed to the client. `spec`/`plan` are the stored JSON documents. */
export interface ChallengeView {
  id: string;
  title: string;
  sponsor: string | null;
  status: string;
  blueprintKey: string | null;
  projectId: number | null;
  brief: string;
  spec: ChallengeSpec | Record<string, never>;
  plan: ChallengePlan | Record<string, never>;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

type Row = typeof challenges.$inferSelect;

export function toChallengeView(row: Row): ChallengeView {
  return {
    id: row.id,
    title: row.title,
    sponsor: row.sponsor,
    status: row.status,
    blueprintKey: row.blueprintKey,
    projectId: row.projectId,
    brief: row.brief,
    spec: (row.spec ?? {}) as ChallengeSpec,
    plan: (row.plan ?? {}) as ChallengePlan,
    error: row.error,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

export async function listChallenges(db: Db, tenantId: number, limit = 50): Promise<ChallengeView[]> {
  const rows = await db
    .select()
    .from(challenges)
    .where(scopedToTenant(challenges, tenantId))
    .orderBy(desc(challenges.createdAt))
    .limit(limit);
  return rows.map(toChallengeView);
}

export async function getChallenge(db: Db, tenantId: number, id: string): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(challenges)
    .where(scopedToTenant(challenges, tenantId, eq(challenges.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createChallenge(
  db: Db,
  args: {
    tenantId: number;
    projectId: number | null;
    brief: string;
    spec: ChallengeSpec;
    plan: ChallengePlan;
    userId: string | null;
  },
): Promise<Row> {
  const [row] = await db
    .insert(challenges)
    .values({
      tenantId: args.tenantId,
      projectId: args.projectId,
      title: args.spec.title.slice(0, 255),
      sponsor: args.spec.sponsor?.slice(0, 255) ?? null,
      brief: args.brief,
      spec: args.spec,
      plan: args.plan,
      blueprintKey: args.plan.blueprintKey,
      status: 'planned',
      createdByUserId: args.userId,
    })
    .returning();
  return row!;
}

/** Replace the spec + plan after a re-read of the same brief. */
export async function updateChallengePlan(
  db: Db,
  tenantId: number,
  id: string,
  args: { spec: ChallengeSpec; plan: ChallengePlan; status: string },
): Promise<Row | null> {
  const [row] = await db
    .update(challenges)
    .set({
      spec: args.spec,
      plan: args.plan,
      blueprintKey: args.plan.blueprintKey,
      title: args.spec.title.slice(0, 255),
      sponsor: args.spec.sponsor?.slice(0, 255) ?? null,
      status: args.status,
      error: null,
      updatedAt: new Date(),
    })
    .where(scopedToTenant(challenges, tenantId, eq(challenges.id, id)))
    .returning();
  return row ?? null;
}

export async function setChallengeStatus(
  db: Db,
  tenantId: number,
  id: string,
  args: { status: string; projectId?: number; error?: string | null },
): Promise<Row | null> {
  const [row] = await db
    .update(challenges)
    .set({
      status: args.status,
      ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
      error: args.error === undefined ? null : args.error?.slice(0, 1000) ?? null,
      updatedAt: new Date(),
    })
    .where(scopedToTenant(challenges, tenantId, eq(challenges.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteChallenge(db: Db, tenantId: number, id: string): Promise<void> {
  await db.delete(challenges).where(scopedToTenant(challenges, tenantId, eq(challenges.id, id)));
}
