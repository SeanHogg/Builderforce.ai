/**
 * SOP recall for the compile primitive.
 *
 * The diagnostic → improvement-agent compiler ({@link compileFromDiagnostic})
 * used to lower a maturity report into steps with no grounding in the org's own
 * documented practice. This module recalls the tenant's published Standard
 * Operating Procedures / Process docs from `knowledge_documents` and BM25-ranks
 * them against the diagnostic subject, so the compiled agent is grounded in how
 * the organization ACTUALLY works — not generic advice.
 *
 * Retrieval reuses the same zero-dep, Worker-safe `bm25Search` primitive as
 * {@link agentKnowledge}, so there is one ranking implementation, not two.
 */
import { bm25Search, type Bm25Doc } from '@seanhogg/builderforce-memory/retrieval';
import { and, eq, inArray, desc } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { knowledgeDocuments } from '../../infrastructure/database/schema';

export interface SopRecallHit {
  id: string;
  title: string;
  docType: string;
  excerpt: string;
}

/** How many SOPs are recalled and grounded into a compiled diagnostic agent. */
export const SOP_RECALL_TOP_K = 4;

/** SOP/Process docs only — plain reference docs are excluded from grounding. */
const SOP_DOC_TYPES = ['sop', 'process'] as const;

/** Clip a doc body to a grounding-sized excerpt (whole words, no mid-word cut). */
function excerpt(text: string, max = 600): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, clean.lastIndexOf(' ', max) || max)}…`;
}

/**
 * Recall the tenant's published SOP/Process docs most relevant to `query`.
 *
 * Not read-through cached: compile is a low-frequency, user-initiated action and
 * grounding must reflect the LATEST published SOPs, so a bounded direct read
 * (published sop/process docs only, capped corpus) is correct over a cache that
 * could serve stale procedure. Returns [] when the query is empty or nothing
 * overlaps — the caller degrades to ungrounded compilation.
 */
export async function recallSops(
  db: Db,
  tenantId: number,
  query: string,
  topK: number = SOP_RECALL_TOP_K,
  docTypes: readonly string[] = SOP_DOC_TYPES,
): Promise<SopRecallHit[]> {
  if (!query.trim()) return [];

  const rows = await db
    .select({
      id: knowledgeDocuments.id,
      title: knowledgeDocuments.title,
      docType: knowledgeDocuments.docType,
      summary: knowledgeDocuments.summary,
      content: knowledgeDocuments.content,
    })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.tenantId, tenantId),
        eq(knowledgeDocuments.status, 'published'),
        inArray(knowledgeDocuments.docType, docTypes as string[]),
      ),
    )
    .orderBy(desc(knowledgeDocuments.updatedAt))
    .limit(200);

  if (rows.length === 0) return [];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const docs: Bm25Doc[] = rows.map((r) => ({
    id: r.id,
    text: `${r.title}\n${r.summary ?? ''}\n${r.content ?? ''}`,
  }));
  const hits = bm25Search(query, docs).slice(0, topK);

  return hits
    .map((h) => byId.get(h.id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      id: r.id,
      title: r.title,
      docType: r.docType,
      excerpt: excerpt(r.content ?? r.summary ?? ''),
    }));
}
