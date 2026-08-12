import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessionObjects, objects } from '../../infrastructure/database/schema';
import { resolveShareToken } from '../kernel/ObjectRegistry';

export type PublicResumeProjection = {
  objectId: string;
  title: string;
  resumeFamily: Record<string, unknown>;
};

type ResumeRevisionRecord = Record<string, unknown> & { id: string };

/**
 * Public links expose one deliberate snapshot, never the private revision
 * history or the tenant-only R2 key of the uploaded source file.
 */
export function projectPublicResumeFamily(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const family = value as Record<string, unknown>;
  if (family.privacy !== 'public' || !Array.isArray(family.revisions)) return null;
  const revisions = family.revisions.filter((item): item is ResumeRevisionRecord =>
    !!item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === 'string');
  const selectedId = [family.masterRevisionId, family.activeRevisionId, family.originalRevisionId]
    .find((candidate) => typeof candidate === 'string' && revisions.some((revision) => revision.id === candidate));
  const selected = revisions.find((revision) => revision.id === selectedId) ?? revisions[0];
  if (!selected) return null;
  const { sourceFile: _sourceFile, ...safeRevision } = selected;
  const revision = { ...safeRevision, kind: 'original', sourceRevisionId: null };
  return {
    version: 1,
    privacy: 'public',
    archivedAt: null,
    watched: false,
    defaultTemplateId: family.defaultTemplateId,
    viewZoom: family.viewZoom,
    originalRevisionId: selected.id,
    activeRevisionId: selected.id,
    masterRevisionId: selected.id,
    revisions: [revision],
  };
}

/** Resolve a hash-only share credential and expose only the resume projection. */
export async function resolvePublicResume(db: Db, token: string): Promise<PublicResumeProjection | null> {
  if (!/^[0-9a-f]{64}$/i.test(token)) return null;
  const grant = await resolveShareToken(db, token);
  if (!grant || grant.scope !== 'view') return null;
  const [row] = await db.select({
    objectId: creationSessionObjects.id,
    kind: creationSessionObjects.kind,
    content: creationSessionObjects.content,
    title: objects.title,
  }).from(objects)
    .innerJoin(creationSessionObjects, sql`${creationSessionObjects.id}::text = ${objects.refId}`)
    .where(and(eq(objects.tenantId, grant.tenantId), eq(objects.id, grant.objectId), eq(objects.kind, 'canvas_resume')))
    .limit(1);
  if (!row || row.kind !== 'resume' || !row.content || typeof row.content !== 'object' || Array.isArray(row.content)) return null;
  const family = projectPublicResumeFamily((row.content as Record<string, unknown>).resumeFamily);
  if (!family) return null;
  return { objectId: row.objectId, title: row.title || 'Resume', resumeFamily: family };
}
