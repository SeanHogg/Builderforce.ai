/**
 * publishKnowledgeDoc — programmatically author + PUBLISH a Knowledge document in one
 * step, mirroring the /api/knowledge create→publish flow (knowledgeRoutes) so an
 * agent-authored doc (e.g. an incident RCA) is a first-class, versioned, searchable,
 * read-acknowledgeable Knowledge article — not a second-class blob.
 *
 * Does exactly what the route pair does: inserts the document already `published`
 * (versionNumber 1, publishedAt), snapshots an immutable v1 into
 * knowledge_document_versions, writes tags, and bumps the knowledge read-through cache
 * so it appears in the Knowledge list immediately.
 */
import { knowledgeDocuments, knowledgeDocumentVersions, knowledgeDocumentTags } from '../../infrastructure/database/schema';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { knowledgeVersionKey } from '../insights/versionKeys';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export interface PublishKnowledgeDocInput {
  tenantId: number;
  projectId?: number | null;
  segmentId?: string | null;
  docType: string;          // 'sop' | 'process' | 'doc' | 'postmortem' | 'known_error'
  title: string;
  summary?: string | null;
  content: string;
  tags?: string[];
  sourceIncidentId?: string | null;
  createdBy?: string | null;
  changeNote?: string | null;
}

/** Insert a doc as published (v1) + version snapshot + tags; bump the knowledge cache.
 *  `env` is optional (absent in tests) — the cache bump is best-effort. Returns the id. */
export async function publishKnowledgeDoc(db: Db, env: Env | undefined, input: PublishKnowledgeDocInput): Promise<{ id: string }> {
  const now = new Date();
  const [doc] = await db.insert(knowledgeDocuments).values({
    tenantId: input.tenantId,
    segmentId: input.segmentId ?? null,
    projectId: input.projectId ?? null,
    docType: input.docType,
    title: input.title.slice(0, 255),
    summary: input.summary?.slice(0, 500) ?? null,
    content: input.content,
    status: 'published',
    versionNumber: 1,
    sourceIncidentId: input.sourceIncidentId ?? null,
    createdBy: input.createdBy ?? null,
    updatedBy: input.createdBy ?? null,
    publishedAt: now,
  }).returning({ id: knowledgeDocuments.id });
  const id = doc!.id;

  await db.insert(knowledgeDocumentVersions).values({
    tenantId: input.tenantId,
    documentId: id,
    versionNumber: 1,
    title: input.title.slice(0, 255),
    content: input.content,
    changeNote: input.changeNote?.slice(0, 500) ?? null,
    publishedBy: input.createdBy ?? null,
  });

  const tags = [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (tags.length) {
    await db.insert(knowledgeDocumentTags).values(tags.map((tag) => ({ tenantId: input.tenantId, documentId: id, tag: tag.slice(0, 64) })));
  }

  if (env) await bumpCacheVersion(env, knowledgeVersionKey(input.tenantId));
  return { id };
}
