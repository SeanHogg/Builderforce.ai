/**
 * Persistence for realizations. The route layer owns HTTP; this owns the table.
 *
 * Every read and write is tenant-scoped through {@link scopedToTenant} rather
 * than by a hand-typed predicate. A realization row carries the idea, the plan
 * and the address the proof is live at, so an unscoped query here would hand one
 * customer another's roadmap and the URL of their unlaunched product.
 */

import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { realizations } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { ChallengePlan } from '../challenge/planChallenge';
import type { ChallengeSpec } from '../challenge/parseBrief';
import type { RealizationKey } from './realizationTarget';

/** The shape handed to the client. `spec`/`plan`/`result` are stored documents. */
export interface RealizationView {
  id: string;
  challengeId: string | null;
  projectId: number | null;
  targetKey: RealizationKey | string;
  title: string;
  strategy: string;
  status: string;
  liveUrl: string | null;
  spec: ChallengeSpec | Record<string, never>;
  plan: ChallengePlan | Record<string, never>;
  result: Record<string, unknown>;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

type Row = typeof realizations.$inferSelect;

export function toRealizationView(row: Row): RealizationView {
  return {
    id: row.id,
    challengeId: row.challengeId,
    projectId: row.projectId,
    targetKey: row.targetKey,
    title: row.title,
    strategy: row.strategy,
    status: row.status,
    liveUrl: row.liveUrl,
    spec: (row.spec ?? {}) as ChallengeSpec,
    plan: (row.plan ?? {}) as ChallengePlan,
    result: (row.result ?? {}) as Record<string, unknown>,
    error: row.error,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

export async function listRealizations(db: Db, tenantId: number, limit = 50): Promise<RealizationView[]> {
  const rows = await db
    .select()
    .from(realizations)
    .where(scopedToTenant(realizations, tenantId))
    .orderBy(desc(realizations.createdAt))
    .limit(limit);
  return rows.map(toRealizationView);
}

export async function getRealization(db: Db, tenantId: number, id: string): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(realizations)
    .where(scopedToTenant(realizations, tenantId, eq(realizations.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createRealization(
  db: Db,
  args: {
    tenantId: number;
    challengeId: string | null;
    projectId: number | null;
    targetKey: string;
    title: string;
    strategy: string;
    spec: ChallengeSpec;
    plan: ChallengePlan;
    userId: string | null;
  },
): Promise<Row> {
  const [row] = await db
    .insert(realizations)
    .values({
      tenantId: args.tenantId,
      challengeId: args.challengeId,
      projectId: args.projectId,
      targetKey: args.targetKey.slice(0, 48),
      title: args.title.slice(0, 255),
      strategy: args.strategy,
      spec: args.spec,
      plan: args.plan,
      status: 'planned',
      createdByUserId: args.userId,
    })
    .returning();
  return row!;
}

/**
 * Record the outcome of a build.
 *
 * `error` is cleared unless one is passed: a retry that succeeded must not leave
 * the previous failure sitting on the row, where the panel would keep showing a
 * problem that no longer exists.
 */
export async function setRealizationOutcome(
  db: Db,
  tenantId: number,
  id: string,
  args: {
    status: string;
    projectId?: number;
    liveUrl?: string | null;
    result?: Record<string, unknown>;
    error?: string | null;
  },
): Promise<Row | null> {
  const [row] = await db
    .update(realizations)
    .set({
      status: args.status,
      ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
      ...(args.liveUrl !== undefined ? { liveUrl: args.liveUrl?.slice(0, 500) ?? null } : {}),
      ...(args.result !== undefined ? { result: args.result } : {}),
      error: args.error === undefined ? null : args.error?.slice(0, 1000) ?? null,
      updatedAt: new Date(),
    })
    .where(scopedToTenant(realizations, tenantId, eq(realizations.id, id)))
    .returning();
  return row ?? null;
}

/** Delete the realization RECORD. The project and the published site it produced
 *  are deliberately left alone — deleting a live proof because a record was
 *  tidied away would be indefensible. */
export async function deleteRealization(db: Db, tenantId: number, id: string): Promise<void> {
  await db.delete(realizations).where(scopedToTenant(realizations, tenantId, eq(realizations.id, id)));
}
