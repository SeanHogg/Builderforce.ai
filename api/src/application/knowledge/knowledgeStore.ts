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
import { factRef, type NodeRef, type StoredFact, type StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
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
/** Rows one provenance delete removes per statement. */
const DELETE_CHUNK = 1_000;

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
    ...(row.provenance ? { provenance: row.provenance } : {}),
    ...(row.extractorVersion ? { extractorVersion: row.extractorVersion } : {}),
    ...(row.toolVersions ? { toolVersions: row.toolVersions } : {}),
    ...(row.previousExtractorVersion ? { previousExtractorVersion: row.previousExtractorVersion } : {}),
    ...(row.previousToolVersions ? { previousToolVersions: row.previousToolVersions } : {}),
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

  const store: KnowledgeStorePort = {
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
        provenance: scope.provenance ?? null,
        // What the review was measured with describes the review at `lastDigest`: stored only with a digest.
        extractorVersion: scope.lastDigest ? scope.extractorVersion ?? null : null,
        toolVersions: scope.lastDigest ? scope.toolVersions ?? null : null,
      };
      // The digest is new: its review's measurement (unknown when unstated) replaces the stored one, which moves to
      // `previous_*` with the digest. The same digest again keeps what is stored unless the write states it.
      const isNewDigest = sql`${knowledgeScopes.lastDigest} IS DISTINCT FROM ${scope.lastDigest ?? null}`;
      const keptUnlessNew = (column: typeof knowledgeScopes.extractorVersion | typeof knowledgeScopes.toolVersions) =>
        sql`CASE WHEN ${isNewDigest} THEN NULL ELSE ${column} END`;
      await db.insert(knowledgeScopes).values(values).onConflictDoUpdate({
        target: [knowledgeScopes.tenantId, knowledgeScopes.projectId, knowledgeScopes.rootId],
        set: {
          title: values.title, packs: values.packs,
          // Only a scope write that states provenance (a pack upload) replaces it; a review's write leaves it.
          ...(scope.provenance ? { provenance: scope.provenance } : {}),
          // A scope write without a digest (an aborted review) keeps the last good one. A NEW
          // digest moves the stored one to `previous_digest` — Compare's baseline; the same
          // digest again (a re-sent final chunk) leaves both as they are.
          ...(scope.lastDigest ? {
            lastDigest: scope.lastDigest,
            previousDigest: sql`CASE WHEN ${knowledgeScopes.lastDigest} IS DISTINCT FROM ${scope.lastDigest} THEN ${knowledgeScopes.lastDigest} ELSE ${knowledgeScopes.previousDigest} END`,
            previousExtractorVersion: sql`CASE WHEN ${isNewDigest} THEN ${knowledgeScopes.extractorVersion} ELSE ${knowledgeScopes.previousExtractorVersion} END`,
            previousToolVersions: sql`CASE WHEN ${isNewDigest} THEN ${knowledgeScopes.toolVersions} ELSE ${knowledgeScopes.previousToolVersions} END`,
            extractorVersion: scope.extractorVersion ?? keptUnlessNew(knowledgeScopes.extractorVersion),
            toolVersions: scope.toolVersions ?? keptUnlessNew(knowledgeScopes.toolVersions),
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

    async markRelationsStaleMany(marks) {
      let marked = 0;
      const CHUNK = 200;
      for (let i = 0; i < marks.length; i += CHUNK) {
        const values = marks.slice(i, i + CHUNK).map((m) => sql`(${m.sourceRef}, ${m.currentHash})`);
        // One statement per chunk: an edge judged from a known, different hash of the source (or one of its sections) goes stale.
        const result = await db.execute(sql`
          UPDATE project_fact_relations r SET stale_at = now()
          FROM (VALUES ${sql.join(values, sql`, `)}) AS m(ref, hash)
          WHERE r.tenant_id = ${tenantId} AND r.project_id = ${projectId}
            AND r.origin = 'model' AND r.stale_at IS NULL AND r.source_hash IS NOT NULL AND r.source_hash <> m.hash
            AND (r.from_ref = m.ref OR starts_with(r.from_ref, m.ref || '#') OR r.to_ref = m.ref OR starts_with(r.to_ref, m.ref || '#'))
        `);
        marked += (result as unknown as { rowCount?: number }).rowCount ?? 0;
      }
      return marked;
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

    async deleteRelationRows(rows, only) {
      let removed = 0;
      const TUPLES = 100;
      for (let i = 0; i < rows.length; i += TUPLES) {
        const tuples = rows.slice(i, i + TUPLES).map((r) => sql`(${r.from}, ${r.to}, ${r.kind})`);
        const gone = await db.delete(projectFactRelations)
          .where(scoped(
            projectFactRelations, tenantId,
            sql`(${projectFactRelations.fromRef}, ${projectFactRelations.toRef}, ${projectFactRelations.kind}) IN (${sql.join(tuples, sql`, `)})`,
            // A pack's tombstone names a MODEL leaf: an edge a person has since made their own stays.
            only?.origin ? eq(projectFactRelations.origin, only.origin) : undefined,
          ))
          .returning({ id: projectFactRelations.id });
        removed += gone.length;
      }
      return removed;
    },

    async relationsTouching(refs) {
      const out: Array<{ from: string; to: string; kind: string; origin: string }> = [];
      for (let i = 0; i < refs.length; i += IN_CHUNK) {
        const chunk = refs.slice(i, i + IN_CHUNK);
        const rows = await db.select({ from: projectFactRelations.fromRef, to: projectFactRelations.toRef, kind: projectFactRelations.kind, origin: projectFactRelations.origin })
          .from(projectFactRelations)
          .where(scoped(projectFactRelations, tenantId, or(inArray(projectFactRelations.fromRef, chunk), inArray(projectFactRelations.toRef, chunk))));
        out.push(...rows);
      }
      return out;
    },

    async deleteFactsByKeys(keys, actor, opts) {
      const deleted: string[] = [];
      const distinct = [...new Set(keys.map((k) => k.trim().slice(0, 255)))];
      for (let i = 0; i < distinct.length; i += IN_CHUNK) {
        const batch = distinct.slice(i, i + IN_CHUNK);
        // The author rule, in SQL: an authorless fact, the actor's own, or any fact for an admin.
        const mayDelete = or(
          isNull(projectFacts.createdBy),
          actor.userId ? eq(projectFacts.createdBy, actor.userId) : undefined,
          actor.admin ? sql`true` : undefined,
        )!;
        const allowed = await db.select({ key: projectFacts.key }).from(projectFacts)
          .where(scoped(projectFacts, tenantId, inArray(projectFacts.key, batch), mayDelete));
        if (allowed.length === 0) continue;
        const allowedKeys = allowed.map((r) => r.key);
        // A pack passes `keepRelations`: it decides, per relation, which of them are its root's alone (see `removeRows`).
        if (!opts?.keepRelations) await store.deleteRelationsOf(allowedKeys.map((k) => factRef(k)));
        const gone = await db.delete(projectFacts)
          .where(scoped(projectFacts, tenantId, inArray(projectFacts.key, allowedKeys), mayDelete))
          .returning({ key: projectFacts.key });
        deleted.push(...gone.map((r) => r.key));
      }
      return deleted;
    },

    async deleteScope(rootId) {
      const rows = await db.delete(knowledgeScopes)
        .where(scoped(knowledgeScopes, tenantId, eq(knowledgeScopes.rootId, rootId)))
        .returning({ id: knowledgeScopes.id });
      return rows.length > 0;
    },

    async factSources(keys) {
      const out = new Map<string, string>();
      const distinct = [...new Set(keys.map((k) => k.trim().slice(0, 255)))];
      for (let i = 0; i < distinct.length; i += IN_CHUNK) {
        const rows = await db.select({ key: projectFacts.key, source: projectFacts.source }).from(projectFacts)
          .where(scoped(projectFacts, tenantId, inArray(projectFacts.key, distinct.slice(i, i + IN_CHUNK))));
        for (const r of rows) out.set(r.key, r.source);
      }
      return out;
    },

    async deleteFactsBySource(source) {
      const deleted: string[] = [];
      let relations = 0;
      for (;;) {
        // Bounded batches by id: one unbounded DELETE could hold a pack's every fact in one statement.
        const batch = await db.select({ id: projectFacts.id, key: projectFacts.key }).from(projectFacts)
          .where(scoped(projectFacts, tenantId, eq(projectFacts.source, source)))
          .limit(DELETE_CHUNK);
        if (batch.length === 0) break;
        // This batch's relations go BEFORE its facts: a failure between the two leaves facts
        // (still selected by source on the retry), never a relation pointing at a deleted fact.
        relations += await store.deleteRelationsOf(batch.map((r) => factRef(r.key)));
        const rows = await db.delete(projectFacts)
          .where(scoped(projectFacts, tenantId, inArray(projectFacts.id, batch.map((r) => r.id))))
          .returning({ key: projectFacts.key });
        deleted.push(...rows.map((r) => r.key));
        if (batch.length < DELETE_CHUNK) break;
      }
      return { keys: deleted, relations };
    },

    async humanRelationKeys(rows) {
      const out = new Set<string>();
      const froms = [...new Set(rows.map((r) => r.from))];
      const wanted = new Set(rows.map((r) => `${r.from}\u0000${r.to}\u0000${r.kind}`));
      for (let i = 0; i < froms.length; i += IN_CHUNK) {
        const found = await db.select({ from: projectFactRelations.fromRef, to: projectFactRelations.toRef, kind: projectFactRelations.kind })
          .from(projectFactRelations)
          .where(scoped(projectFactRelations, tenantId, eq(projectFactRelations.origin, 'human'), inArray(projectFactRelations.fromRef, froms.slice(i, i + IN_CHUNK))));
        for (const r of found) {
          const key = `${r.from}\u0000${r.to}\u0000${r.kind}`;
          if (wanted.has(key)) out.add(key);
        }
      }
      return out;
    },

    async deleteRelationsUnder(rootId) {
      const prefix = `${escapeLike(`src:${rootId}::`)}%`;
      let removed = 0;
      for (;;) {
        const ids = await db.select({ id: projectFactRelations.id }).from(projectFactRelations)
          .where(scoped(projectFactRelations, tenantId, or(
            sql`${projectFactRelations.fromRef} LIKE ${prefix}`,
            sql`${projectFactRelations.toRef} LIKE ${prefix}`,
          )))
          .limit(DELETE_CHUNK);
        if (ids.length === 0) break;
        const rows = await db.delete(projectFactRelations)
          .where(scoped(projectFactRelations, tenantId, inArray(projectFactRelations.id, ids.map((r) => r.id))))
          .returning({ id: projectFactRelations.id });
        removed += rows.length;
        if (ids.length < DELETE_CHUNK) break;
      }
      return removed;
    },

    async factAuthors(keys) {
      const out = new Map<string, string | null>();
      const distinct = [...new Set(keys.map((k) => k.trim().slice(0, 255)))];
      for (let i = 0; i < distinct.length; i += IN_CHUNK) {
        const rows = await db.select({ key: projectFacts.key, createdBy: projectFacts.createdBy }).from(projectFacts)
          .where(scoped(projectFacts, tenantId, inArray(projectFacts.key, distinct.slice(i, i + IN_CHUNK))));
        for (const r of rows) out.set(r.key, r.createdBy ?? null);
      }
      return out;
    },

    async factAuthor(key) {
      const [row] = await db.select({ createdBy: projectFacts.createdBy }).from(projectFacts)
        .where(scoped(projectFacts, tenantId, eq(projectFacts.key, key.trim().slice(0, 255))))
        .limit(1);
      return row ? row.createdBy ?? null : undefined;
    },
  };
  return store;
}
