/**
 * EMP-17 — Documentation-activity metrics.
 *
 * Surfaces who is keeping the knowledge base alive: per member (human authors), how
 * many knowledge documents they authored, how many published revisions (edits) they
 * shipped, and how many document versions they read & acknowledged, over a window.
 * Sourced from the Knowledge Management tables (0227):
 *   - knowledge_documents.created_by          → docsAuthored
 *   - knowledge_document_versions.published_by → edits (published revisions)
 *   - knowledge_acknowledgements.user_id       → acksGiven
 *
 * All three signals are human-authored (agents don't author SOPs), so members are
 * `human` identity. {@link scoreDocActivity} is pure for unit testing.
 */
import { and, count, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  knowledgeAcknowledgements, knowledgeDocuments, knowledgeDocumentVersions, users,
} from '../../infrastructure/database/schema';

const HOUR_MS = 3_600_000;

export interface DocActivityRow {
  memberKind: 'human';
  memberRef: string;
  name: string;
  docsAuthored: number;
  edits: number;
  acksGiven: number;
  /** Weighted authorship score: authored×3 + edits×2 + acks×1. */
  score: number;
}

export interface DocContribution { userId: string; docsAuthored: number; edits: number; acksGiven: number }

/** Pure: turn per-user contribution counts + a name map into ranked rows. */
export function scoreDocActivity(rows: DocContribution[], nameByUser: Map<string, string>): DocActivityRow[] {
  return rows
    .map((r) => ({
      memberKind: 'human' as const,
      memberRef: r.userId,
      name: nameByUser.get(r.userId) ?? r.userId,
      docsAuthored: r.docsAuthored,
      edits: r.edits,
      acksGiven: r.acksGiven,
      score: r.docsAuthored * 3 + r.edits * 2 + r.acksGiven,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export interface DocActivityResult {
  windowDays: number;
  members: DocActivityRow[];
  totals: { docsAuthored: number; edits: number; acksGiven: number };
}

export async function computeDocActivity(db: Db, tenantId: number, days: number): Promise<DocActivityResult> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);

  const [authored, edited, acked] = await Promise.all([
    db.select({ userId: knowledgeDocuments.createdBy, n: count() })
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.tenantId, tenantId), gte(knowledgeDocuments.createdAt, since), isNotNull(knowledgeDocuments.createdBy)))
      .groupBy(knowledgeDocuments.createdBy),
    db.select({ userId: knowledgeDocumentVersions.publishedBy, n: count() })
      .from(knowledgeDocumentVersions)
      .where(and(eq(knowledgeDocumentVersions.tenantId, tenantId), gte(knowledgeDocumentVersions.createdAt, since), isNotNull(knowledgeDocumentVersions.publishedBy)))
      .groupBy(knowledgeDocumentVersions.publishedBy),
    db.select({ userId: knowledgeAcknowledgements.userId, n: count() })
      .from(knowledgeAcknowledgements)
      .where(and(eq(knowledgeAcknowledgements.tenantId, tenantId), gte(knowledgeAcknowledgements.acknowledgedAt, since)))
      .groupBy(knowledgeAcknowledgements.userId),
  ]);

  const byUser = new Map<string, DocContribution>();
  const ensure = (userId: string): DocContribution => {
    let c = byUser.get(userId);
    if (!c) { c = { userId, docsAuthored: 0, edits: 0, acksGiven: 0 }; byUser.set(userId, c); }
    return c;
  };
  for (const r of authored) if (r.userId) ensure(r.userId).docsAuthored = Number(r.n);
  for (const r of edited) if (r.userId) ensure(r.userId).edits = Number(r.n);
  for (const r of acked) if (r.userId) ensure(r.userId).acksGiven = Number(r.n);

  const ids = [...byUser.keys()];
  const nameByUser = new Map<string, string>();
  if (ids.length) {
    const nameRows = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids));
    for (const r of nameRows) nameByUser.set(r.id, r.name || r.id);
  }

  const members = scoreDocActivity([...byUser.values()], nameByUser);
  const totals = members.reduce(
    (acc, m) => ({ docsAuthored: acc.docsAuthored + m.docsAuthored, edits: acc.edits + m.edits, acksGiven: acc.acksGiven + m.acksGiven }),
    { docsAuthored: 0, edits: 0, acksGiven: 0 },
  );
  return { windowDays: days, members, totals };
}
