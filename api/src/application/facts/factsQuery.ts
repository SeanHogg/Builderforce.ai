/**
 * FACTS library query compute — the read side of /api/facts.
 *
 * A fact is a structured (subject, predicate, object) triple with provenance
 * (source, confidence, author). This module holds the pure query builders so the
 * route stays thin and the same filtering logic is reusable (e.g. by an agent
 * tool that recalls facts). Everything is tenant-scoped; an optional projectId
 * narrows to a project (null projectId rows are tenant-global facts).
 */

import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { facts } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export interface FactRow {
  id: string;
  projectId: number | null;
  subject: string;
  predicate: string;
  object: string;
  source: string | null;
  confidence: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FactsFilter {
  subject?: string;
  predicate?: string;
  /** Free-text match across subject / predicate / object. */
  q?: string;
  projectId?: number | null;
  limit?: number;
  offset?: number;
}

/** Query facts for a tenant with optional subject / predicate / free-text filters. */
export async function queryFacts(db: Db, tenantId: number, filter: FactsFilter): Promise<FactRow[]> {
  const conds = [eq(facts.tenantId, tenantId)];
  if (filter.subject) conds.push(eq(facts.subject, filter.subject));
  if (filter.predicate) conds.push(eq(facts.predicate, filter.predicate));
  if (filter.projectId != null) conds.push(eq(facts.projectId, filter.projectId));
  if (filter.q) {
    const like = `%${filter.q}%`;
    conds.push(or(ilike(facts.subject, like), ilike(facts.predicate, like), ilike(facts.object, like))!);
  }

  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);

  const rows = await db
    .select()
    .from(facts)
    .where(and(...conds))
    .orderBy(desc(facts.updatedAt))
    .limit(limit)
    .offset(offset);

  return rows.map(toFactRow);
}

/** Distinct subjects + predicates for a tenant (drives the filter dropdowns). */
export async function factsSchema(db: Db, tenantId: number): Promise<{ subjects: string[]; predicates: string[] }> {
  const [subjects, predicates] = await Promise.all([
    db.selectDistinct({ v: facts.subject }).from(facts).where(eq(facts.tenantId, tenantId)).orderBy(facts.subject),
    db.selectDistinct({ v: facts.predicate }).from(facts).where(eq(facts.tenantId, tenantId)).orderBy(facts.predicate),
  ]);
  return {
    subjects: subjects.map((r) => r.v).filter(Boolean),
    predicates: predicates.map((r) => r.v).filter(Boolean),
  };
}

/** Normalize a DB row (Date columns, numeric-string confidence) to the wire shape. */
export function toFactRow(r: typeof facts.$inferSelect): FactRow {
  return {
    id: r.id,
    projectId: r.projectId ?? null,
    subject: r.subject,
    predicate: r.predicate,
    object: r.object,
    source: r.source ?? null,
    confidence: r.confidence ?? null,
    createdBy: r.createdBy ?? null,
    createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as string)).toISOString(),
    updatedAt: (r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt as unknown as string)).toISOString(),
  };
}
