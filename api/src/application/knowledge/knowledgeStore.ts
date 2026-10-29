/**
 * knowledgeStore — the Postgres adapter behind {@link KnowledgeStorePort}: the stored half
 * of the knowledge graph (PRD 38 §4.2) for one (tenant, project).
 *
 *   facts      `project_facts` rows anchored to the root's sources (read only — every fact
 *              WRITE goes through `upsertProjectFact`, reached from `writeKnowledge`);
 *   relations  `project_fact_relations`, upserted on (tenant, project, from, to, kind);
 *   scopes     `knowledge_scopes`, one row per reviewed root.
 *
 * Scope membership is derived, never stored (3NF): a fact belongs to a root when one of its
 * anchors names one of the root's sources; a relation when an end is one of the root's
 * `src:` refs or one of those facts.
 */
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { eq, gt, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { type NodeRef, type StoredFact, type StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { knowledgeScopes, projectFactRelations, projectFacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import { escapeLike } from '../replay/replayFilterCompiler';
import { pathKey } from '../llm/projectFactsCodemap';
import { QA_CACHE_SOURCE } from '../llm/projectFactsStore';
import type { KnowledgeScope, KnowledgeStorePort } from './knowledgePorts';

/** Anchored facts read per graph build (the newest win past it). */
export const MAX_SCOPE_FACTS = 5_000;
/** Relations read per graph build. */
export const MAX_SCOPE_RELATIONS = 20_000;
/** Refs bound per `IN (…)` list. */
const IN_CHUNK = 500;

type FactOriginColumn = 'model' | 'human' | 'agent' | null;

/** A row's knowledge origin: the stored one, else `human` when a person is recorded, else `agent`. */
export function factOriginOf(origin: FactOriginColumn | undefined, createdBy: string | null | undefined): StoredFact['origin'] {
  return origin ?? (createdBy ? 'human' : 'agent');
}

function toScopeRecord(row: typeof knowledgeScopes.$inferSelect): KnowledgeScope {
  return {
    rootId: row.rootId,
    title: row.title ?? row.rootId,
    packs: [...row.packs],
    ...(row.lastDigest ? { lastDigest: row.lastDigest } : {}),
    ...(row.previousDigest ? { previousDigest: row.previousDigest } : {}),
    ...(row.lastReviewedAt ? { lastReviewedAt: row.lastReviewedAt.toISOString() } : {}),
  };
}

function toRelation(row: typeof projectFactRelations.$inferSelect): StoredRelation {
  return {
    from: row.fromRef as NodeRef,
    to: row.toRef as NodeRef,
    kind: row.kind,
    weight: row.weight,
    origin: row.origin,
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
    ...(row.sourceHash ? { sourceHash: row.sourceHash } : {}),
    staleAt: row.staleAt ? row.staleAt.toISOString() : null,
  };
}

/** `ref` itself or one of its sections (`ref#slug`). */
function onSource(column: AnyPgColumn, ref: string): SQL {
  return or(eq(column, ref), sql`${column} LIKE ${`${escapeLike(ref)}#%`}`)!;
}

export function drizzleKnowledgeStore(db: Db, tenantId: number, projectId: number): KnowledgeStorePort {
  // `tenantId` is passed at every call so each statement names its tenant predicate.
  const scoped = (table: typeof knowledgeScopes | typeof projectFactRelations | typeof projectFacts, tenant: number, ...conds: Array<SQL | undefined>) =>
    scopedToTenant(table, tenant, eq(table.projectId, projectId), ...conds);

  return {
    async scopes() {
      const rows = await db.select().from(knowledgeScopes).where(scoped(knowledgeScopes, tenantId)).orderBy(knowledgeScopes.rootId);
      return rows.map(toScopeRecord);
    },

    async scope(rootId) {
      const [row] = await db.select().from(knowledgeScopes).where(scoped(knowledgeScopes, tenantId, eq(knowledgeScopes.rootId, rootId))).limit(1);
      return row ? toScopeRecord(row) : null;
    },

    async facts(paths) {
      if (paths.size === 0) return [];
      const wanted = new Set([...paths].map(pathKey));
      const now = new Date();
      const rows = await db
        .select({
          key: projectFacts.key, content: projectFacts.content, source: projectFacts.source, importance: projectFacts.importance,
          fileAnchors: projectFacts.fileAnchors, updatedAt: projectFacts.updatedAt, createdBy: projectFacts.createdBy, origin: projectFacts.origin,
        })
        .from(projectFacts)
        .where(scoped(
          projectFacts, tenantId,
          isNull(projectFacts.supersededBy),
          sql`${projectFacts.fileAnchors} IS NOT NULL`,
          ne(projectFacts.source, QA_CACHE_SOURCE),
          or(isNull(projectFacts.expiresAt), gt(projectFacts.expiresAt, now)),
        ))
        .orderBy(sql`${projectFacts.updatedAt} DESC`)
        .limit(MAX_SCOPE_FACTS);
      const out: StoredFact[] = [];
      for (const r of rows) {
        const anchors = (r.fileAnchors ?? []).filter((a) => typeof a?.path === 'string');
        if (!anchors.some((a) => wanted.has(pathKey(a.path)))) continue;
        out.push({
          key: r.key, content: r.content, source: r.source, importance: r.importance,
          origin: factOriginOf(r.origin, r.createdBy),
          fileAnchors: anchors.map((a) => ({
            path: a.path,
            ...(typeof a.line === 'number' ? { line: a.line } : {}),
            ...(a.contentHash ? { contentHash: a.contentHash } : {}),
          })),
          updatedAt: r.updatedAt.toISOString(),
          createdBy: r.createdBy ?? null,
        });
      }
      return out;
    },

    async relations(rootId, factRefs) {
      const prefix = `${escapeLike(`src:${rootId}::`)}%`;
      const bySource = or(
        sql`${projectFactRelations.fromRef} LIKE ${prefix}`,
        sql`${projectFactRelations.toRef} LIKE ${prefix}`,
      );
      const refs = [...factRefs];
      const chunks: string[][] = [];
      for (let i = 0; i < refs.length; i += IN_CHUNK) chunks.push(refs.slice(i, i + IN_CHUNK));
      const predicates: SQL[] = [bySource!];
      for (const chunk of chunks) {
        predicates.push(or(inArray(projectFactRelations.fromRef, chunk), inArray(projectFactRelations.toRef, chunk))!);
      }
      const seen = new Set<string>();
      const out: StoredRelation[] = [];
      for (const predicate of predicates) {
        const rows = await db.select().from(projectFactRelations)
          .where(scoped(projectFactRelations, tenantId, predicate))
          .limit(MAX_SCOPE_RELATIONS);
        for (const row of rows) {
          if (seen.has(row.id) || out.length >= MAX_SCOPE_RELATIONS) continue;
          seen.add(row.id);
          out.push(toRelation(row));
        }
      }
      return out;
    },

    async upsertRelations(rows, createdBy) {
      if (rows.length === 0) return 0;
      await db.insert(projectFactRelations)
        .values(rows.map((r) => ({
          tenantId, projectId, fromRef: r.from, toRef: r.to, kind: r.kind, weight: r.weight, origin: r.origin,
          confidence: r.confidence ?? null, sourceHash: r.sourceHash ?? null,
          staleAt: r.staleAt ? new Date(r.staleAt) : null,
          // Authorship is a person's: only a human edge records its writer.
          createdBy: r.origin === 'human' ? createdBy : null,
        })))
        .onConflictDoUpdate({
          target: [projectFactRelations.tenantId, projectFactRelations.projectId, projectFactRelations.fromRef, projectFactRelations.toRef, projectFactRelations.kind],
          // A re-judged edge replaces its weight, confidence and hash, and is current again
          // unless the writer says otherwise. Authorship stays with the first writer.
          set: {
            weight: sql`excluded.weight`, origin: sql`excluded.origin`, confidence: sql`excluded.confidence`,
            sourceHash: sql`excluded.source_hash`, staleAt: sql`excluded.stale_at`,
          },
        });
      return rows.length;
    },

    async upsertScope(scope) {
      const values = {
        tenantId, projectId, rootId: scope.rootId, title: scope.title?.slice(0, 255) || scope.rootId.slice(0, 255), packs: [...scope.packs],
        lastDigest: scope.lastDigest ?? null,
        lastReviewedAt: scope.lastReviewedAt ? new Date(scope.lastReviewedAt) : null,
      };
      await db.insert(knowledgeScopes).values(values).onConflictDoUpdate({
        target: [knowledgeScopes.tenantId, knowledgeScopes.projectId, knowledgeScopes.rootId],
        set: {
          title: values.title, packs: values.packs,
          // A scope write without a digest (an aborted review) keeps the last good one. A NEW
          // digest moves the stored one to `previous_digest` — Compare's baseline; the same
          // digest again (a re-sent final chunk) leaves both as they are.
          ...(scope.lastDigest ? {
            lastDigest: scope.lastDigest,
            previousDigest: sql`CASE WHEN ${knowledgeScopes.lastDigest} IS DISTINCT FROM ${scope.lastDigest} THEN ${knowledgeScopes.lastDigest} ELSE ${knowledgeScopes.previousDigest} END`,
          } : {}),
          ...(scope.lastReviewedAt ? { lastReviewedAt: values.lastReviewedAt } : {}),
        },
      });
    },

    async markRelationsStale(sourceRef, currentHash) {
      const rows = await db.update(projectFactRelations)
        .set({ staleAt: new Date() })
        .where(scoped(
          projectFactRelations, tenantId,
          eq(projectFactRelations.origin, 'model'),
          isNull(projectFactRelations.staleAt),
          // Only an edge judged from a KNOWN, different hash goes stale; one with no hash has no
          // baseline to differ from.
          isNotNull(projectFactRelations.sourceHash),
          ne(projectFactRelations.sourceHash, currentHash),
          or(onSource(projectFactRelations.fromRef, sourceRef), onSource(projectFactRelations.toRef, sourceRef)),
        ))
        .returning({ id: projectFactRelations.id });
      return rows.length;
    },

    async deleteRelationsOf(refs) {
      const all = typeof refs === 'string' ? [refs] : [...refs];
      let removed = 0;
      for (let i = 0; i < all.length; i += IN_CHUNK) {
        const chunk = all.slice(i, i + IN_CHUNK);
        const rows = await db.delete(projectFactRelations)
          .where(scoped(projectFactRelations, tenantId, or(inArray(projectFactRelations.fromRef, chunk), inArray(projectFactRelations.toRef, chunk))))
          .returning({ id: projectFactRelations.id });
        removed += rows.length;
      }
      return removed;
    },

    async factAuthor(key) {
      const [row] = await db.select({ createdBy: projectFacts.createdBy }).from(projectFacts)
        .where(scoped(projectFacts, tenantId, eq(projectFacts.key, key.trim().slice(0, 255))))
        .limit(1);
      return row ? row.createdBy ?? null : undefined;
    },
  };
}
