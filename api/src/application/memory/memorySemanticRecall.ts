/**
 * The semantic arm of governed recall: a pgvector ANN read over each memory store,
 * fused with the lexical arm on the shared retrieval formula.
 *
 * Kept separate from `memoryService` so the service stays "resolve the scope chain,
 * union the stores, dedupe by specificity" and this file stays "given a scope and a
 * query vector, which rows are closest". The two stores differ only in their table
 * and scope predicate, so they share one query builder here rather than growing two
 * near-identical blocks inside the service.
 */

import { and, asc, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';
import { agentMemory, projectFacts } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { MEMORY_EMBEDDING_MODEL } from './memoryEmbedding';

/** One candidate from either arm, before fusion. */
export interface RecalledRow {
  /** Stable identity for fusion — the store plus the row's key. */
  id: string;
  key: string;
  content: string;
  scopeKind: string;
  origin: string;
  expiresAt: Date | null;
  /** Cosine similarity in [0,1] for a semantic hit; 0 for a lexical-only hit. */
  vectorScore: number;
}

/** `1 - cosine_distance`, floored at 0 so a fused score never goes negative. */
const similarity = (column: SQL | ReturnType<typeof sql>, literal: string) =>
  sql<number>`greatest(0, 1 - (${column} <=> ${literal}::vector))`;

/** Rows still in force: no expiry, or an expiry in the future.
 *  Typed against the column, not against ONE table's column — both stores carry the
 *  same nullable `expires_at` and the predicate is the same sentence about either. */
const unexpired = (expiresAt: PgColumn) => or(isNull(expiresAt), gt(expiresAt, new Date()));

/**
 * The scoped store's ANN arm: the `limit` nearest rows in the given scopes whose
 * vector came from the pinned model. Ordering is by distance, so a relevant row
 * outside any importance window is reachable — the whole point of 1134.
 */
export async function annRecallScoped(
  db: Db,
  tenantId: number,
  scopes: ReadonlyArray<{ kind: string; id: number }>,
  queryVector: string,
  limit: number,
): Promise<RecalledRow[]> {
  if (scopes.length === 0) return [];
  const scopeClause = or(
    ...scopes.map((s) => and(eq(agentMemory.scopeKind, s.kind), eq(agentMemory.scopeId, s.id))),
  );
  const rows = await db
    .select({
      key: agentMemory.key,
      content: agentMemory.content,
      scopeKind: agentMemory.scopeKind,
      origin: agentMemory.origin,
      expiresAt: agentMemory.expiresAt,
      score: similarity(sql`${agentMemory.embedding}`, queryVector),
    })
    .from(agentMemory)
    .where(
      scopedToTenant(
        agentMemory,
        tenantId,
        scopeClause,
        unexpired(agentMemory.expiresAt),
        eq(agentMemory.embeddingModel, MEMORY_EMBEDDING_MODEL),
      ),
    )
    .orderBy(sql`${agentMemory.embedding} <=> ${queryVector}::vector`)
    .limit(limit);
  return rows.map((r) => ({
    id: `scoped:${r.scopeKind}:${r.key}`,
    key: r.key,
    content: r.content,
    scopeKind: r.scopeKind,
    origin: r.origin,
    expiresAt: r.expiresAt ? new Date(r.expiresAt) : null,
    vectorScore: Number(r.score ?? 0),
  }));
}

/** The project store's ANN arm. Q&A cache rows are excluded, as in lexical recall. */
export async function annRecallProject(
  db: Db,
  tenantId: number,
  projectId: number,
  queryVector: string,
  limit: number,
  qaCacheSource: string,
): Promise<RecalledRow[]> {
  const rows = await db
    .select({
      key: projectFacts.key,
      content: projectFacts.content,
      expiresAt: projectFacts.expiresAt,
      score: similarity(sql`${projectFacts.embedding}`, queryVector),
    })
    .from(projectFacts)
    .where(
      scopedToTenant(
        projectFacts,
        tenantId,
        eq(projectFacts.projectId, projectId),
        sql`${projectFacts.source} <> ${qaCacheSource}`,
        unexpired(projectFacts.expiresAt),
        eq(projectFacts.embeddingModel, MEMORY_EMBEDDING_MODEL),
      ),
    )
    .orderBy(sql`${projectFacts.embedding} <=> ${queryVector}::vector`)
    .limit(limit);
  return rows.map((r) => ({
    id: `project:${r.key}`,
    key: r.key,
    content: r.content,
    scopeKind: 'project',
    origin: 'agent',
    expiresAt: r.expiresAt ? new Date(r.expiresAt) : null,
    vectorScore: Number(r.score ?? 0),
  }));
}

/** Rows with no vector yet, oldest-updated first — the backfill sweep's claim. */
export async function unembeddedMemories(db: Db, limit: number): Promise<Array<{ id: string; key: string; content: string }>> {
  return db
    .select({ id: agentMemory.id, key: agentMemory.key, content: agentMemory.content })
    .from(agentMemory)
    // DECLARED cross-tenant: the backfill is a platform sweep over rows written
    // before migration 1134 (or whose embed failed), and there is no tenant to scope
    // by — the claim set is "every row with no vector", deployment-wide. The vector
    // it writes is derived from content the row already holds, so nothing crosses a
    // tenant boundary; recall stays tenant-scoped in the two ANN reads above.
    .where(acrossTenants(agentMemory, 'scheduled_sweep', isNull(agentMemory.embedding)))
    // OLDEST first, as the doc says: the population this drains is everything written
    // before 1134, and newest-first would re-serve the same recent slice every pass
    // while the backlog it exists for never moved.
    .orderBy(asc(agentMemory.updatedAt))
    .limit(limit);
}

/** Project facts with no vector yet — the project half of the same sweep. */
export async function unembeddedProjectFacts(db: Db, limit: number): Promise<Array<{ id: string; key: string; content: string }>> {
  return db
    .select({ id: projectFacts.id, key: projectFacts.key, content: projectFacts.content })
    .from(projectFacts)
    // Same declared sweep, project half — see `unembeddedMemories`.
    .where(acrossTenants(projectFacts, 'scheduled_sweep', isNull(projectFacts.embedding)))
    .orderBy(asc(projectFacts.updatedAt))
    .limit(limit);
}
