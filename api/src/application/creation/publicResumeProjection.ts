import { and, eq, sql } from 'drizzle-orm';
import { projectPublicResumeFamily, type CanvasResumeFamily } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessionObjects, objects } from '../../infrastructure/database/schema';
import { resolveShareToken } from '../kernel/ObjectRegistry';

export type PublicResumeProjection = {
  objectId: string;
  title: string;
  resumeFamily: CanvasResumeFamily;
};

/**
 * Public links expose one deliberate snapshot, never the private revision history or
 * the tenant-only R2 key of the uploaded source file.
 *
 * The projection itself now lives in `@builderforce/creation-canvas-contract` — this
 * module used to carry its own copy, which meant the server and the editor each
 * decided independently which revision was "the live one" and could disagree.
 */
export { projectPublicResumeFamily };

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
