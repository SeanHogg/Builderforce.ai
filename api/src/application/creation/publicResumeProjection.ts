import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessionObjects, objects } from '../../infrastructure/database/schema';
import { resolveShareToken } from '../kernel/ObjectRegistry';

export type PublicResumeProjection = {
  objectId: string;
  title: string;
  resumeFamily: Record<string, unknown>;
};

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
  const family = (row.content as Record<string, unknown>).resumeFamily;
  if (!family || typeof family !== 'object' || Array.isArray(family) || (family as Record<string, unknown>).privacy !== 'public') return null;
  return { objectId: row.objectId, title: row.title || 'Resume', resumeFamily: family as Record<string, unknown> };
}
