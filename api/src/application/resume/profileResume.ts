/**
 * The résumé a PERSON owns, persisted as the Canvas object it already is.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────────
 * A for-hire profile used to keep a résumé as one flat R2 file plus a cached JSON blob
 * on `freelancer_profiles`, and showed it by embedding an iframe from hired.video. That
 * gave the person no master/variant history, no choice of design, and no way to edit —
 * while the platform's own Canvas résumé had all three and was not reachable from the
 * profile. The two halves are joined here.
 *
 * The résumé is NOT a new table. It is a `creation_session_objects` row of kind
 * `resume`, exactly like one authored on a board, registered in the kernel `objects`
 * table so it can be shared by token. `freelancer_profiles.resume_object_id` points at
 * it. That is what makes "open my résumé on the canvas" and "show my résumé on my
 * profile" the same document rather than two that drift.
 *
 * ── LAYERING ─────────────────────────────────────────────────────────────────────
 * `career/` is pure by contract — no DB, no env. This is the application module that
 * gives those pure readers something to read: it owns the persistence, and calls into
 * `career/` for every judgement about the résumé's CONTENT.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  createResumeFamily,
  masterResumeRevision,
  resumeFamilyFromValue,
  type CanvasResumeDocument,
  type CanvasResumeFamily,
} from '@builderforce/creation-canvas-contract';
import { registerObject, findObject } from '../kernel/ObjectRegistry';
import { creationSessionObjects, creationSessions, freelancerProfiles } from '../../infrastructure/database/schema';
import { TenantRepository } from '../../infrastructure/repositories/TenantRepository';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Title of the canvas session that holds a person's own career artefacts. */
export const CAREER_SESSION_TITLE = 'My résumé';

export interface ProfileResumeRef {
  tenantId: number;
  sessionId: string;
  /** `creation_session_objects.id` — the résumé document itself. */
  objectId: string;
  /** `objects.id` — the kernel registration, which is what a share token grants on. */
  registryId: string;
}

/** The résumé object plus its decoded family, for callers that need both. */
export interface ProfileResume extends ProfileResumeRef {
  title: string;
  family: CanvasResumeFamily;
}

/**
 * The workspace a person's own artefacts live in.
 *
 * A for-hire account is provisioned one by `ensurePersonalWorkspace`; this resolves it
 * and returns null when there is none, so every caller degrades to "no résumé yet"
 * rather than throwing at a person who simply has not been provisioned yet.
 */
export async function resolvePersonalTenantId(db: Db, userId: string): Promise<number | null> {
  const owned = await new TenantRepository(db).findByUserId(userId);
  const first = owned[0] as { id?: number } | undefined;
  return typeof first?.id === 'number' ? first.id : null;
}

/** Find-or-create the canvas session that holds this person's career artefacts. */
async function ensureCareerSession(db: Db, tenantId: number, userId: string): Promise<string> {
  const [existing] = await db.select({ id: creationSessions.id })
    .from(creationSessions)
    .where(and(
      eq(creationSessions.tenantId, tenantId),
      eq(creationSessions.title, CAREER_SESSION_TITLE),
      sql`${creationSessions.archivedAt} IS NULL`,
    ))
    .orderBy(desc(creationSessions.createdAt))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db.insert(creationSessions).values({
    tenantId,
    title: CAREER_SESSION_TITLE,
    createdBy: userId,
    updatedBy: userId,
    canvasRevision: 1,
  }).returning({ id: creationSessions.id });
  return created!.id;
}

/**
 * Register the résumé in the kernel `objects` table.
 *
 * Done on every write rather than only on create so a title change propagates to the
 * share link and the seat's item list — `registerObject` is an upsert on
 * `(tenant, kind, refId)`, so this is idempotent.
 */
async function registerResume(
  db: Db,
  env: Env,
  args: { tenantId: number; objectId: string; title: string },
): Promise<string> {
  const registered = await registerObject(db, env, {
    tenantId: args.tenantId,
    kind: 'canvas_resume',
    refId: args.objectId,
    domain: 'canvas',
    title: args.title,
  });
  return registered.id;
}

/** Read the résumé a profile points at, or null when it has none. */
export async function readProfileResume(db: Db, userId: string): Promise<ProfileResume | null> {
  const [profile] = await db.select({ objectId: freelancerProfiles.resumeObjectId })
    .from(freelancerProfiles)
    .where(eq(freelancerProfiles.userId, userId))
    .limit(1);
  if (!profile?.objectId) return null;

  const [row] = await db.select({
    objectId: creationSessionObjects.id,
    sessionId: creationSessionObjects.sessionId,
    kind: creationSessionObjects.kind,
    content: creationSessionObjects.content,
    tenantId: creationSessions.tenantId,
  }).from(creationSessionObjects)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
    .where(eq(creationSessionObjects.id, profile.objectId))
    .limit(1);
  if (!row || row.kind !== 'resume') return null;

  const content = (row.content ?? {}) as Record<string, unknown>;
  const family = resumeFamilyFromValue(content.resumeFamily);
  if (!family) return null;
  const registered = await findObject(db, row.tenantId, 'canvas_resume', row.objectId);
  return {
    tenantId: row.tenantId,
    sessionId: row.sessionId,
    objectId: row.objectId,
    registryId: registered?.id ?? '',
    title: typeof content.title === 'string' && content.title.trim() ? content.title : 'Resume',
    family,
  };
}

/**
 * Create the person's résumé object from an imported document, or add the import as a
 * NEW REVISION when they already have one.
 *
 * The second case is the whole point of the non-destructive rule: uploading a second
 * file must not silently discard the variants they tailored from the first. An upload
 * always becomes a revision of the family that already exists.
 */
export async function saveImportedResume(
  db: Db,
  env: Env,
  args: {
    userId: string;
    tenantId: number;
    title: string;
    markdown: string;
    document?: CanvasResumeDocument;
    sourceFile?: { key?: string | null; name: string; mimeType: string; size: number };
  },
): Promise<ProfileResumeRef> {
  const existing = await readProfileResume(db, args.userId);
  const now = new Date().toISOString();

  if (existing) {
    const revisionId = crypto.randomUUID();
    const family: CanvasResumeFamily = {
      ...existing.family,
      activeRevisionId: revisionId,
      revisions: [
        ...existing.family.revisions,
        {
          id: revisionId,
          // An uploaded file is a SOURCE, not something derived from a prior revision —
          // so it carries no `sourceRevisionId` and can never be "restored" onto.
          kind: 'original',
          title: args.title,
          markdown: args.markdown,
          ...(args.document ? { document: args.document, structuredStale: false } : {}),
          templateId: existing.family.defaultTemplateId,
          pageSize: 'a4',
          orientation: 'portrait',
          ...(args.sourceFile ? { sourceFile: args.sourceFile } : {}),
          sourceRevisionId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    await writeProfileResumeFamily(db, env, { ...existing, userId: args.userId }, family);
    return existing;
  }

  const family = createResumeFamily({
    title: args.title,
    markdown: args.markdown,
    ...(args.document ? { document: args.document } : {}),
    ...(args.sourceFile ? { sourceFile: args.sourceFile } : {}),
    now,
  });
  const sessionId = await ensureCareerSession(db, args.tenantId, args.userId);
  const [created] = await db.insert(creationSessionObjects).values({
    sessionId,
    kind: 'resume',
    content: { title: args.title, resumeFamily: family },
    canvasData: { x: 0, y: 0, width: 420, height: 560 },
    searchText: args.title,
    createdBy: args.userId,
    updatedBy: args.userId,
  }).returning({ id: creationSessionObjects.id });

  const objectId = created!.id;
  const registryId = await registerResume(db, env, { tenantId: args.tenantId, objectId, title: args.title });
  await db.update(freelancerProfiles)
    .set({ resumeObjectId: objectId, updatedAt: sql`now()` })
    .where(eq(freelancerProfiles.userId, args.userId));

  return { tenantId: args.tenantId, sessionId, objectId, registryId };
}

/** Persist a modified family back onto the résumé object. */
export async function writeProfileResumeFamily(
  db: Db,
  env: Env,
  ref: ProfileResumeRef & { userId: string; title?: string },
  family: CanvasResumeFamily,
): Promise<void> {
  const title = ref.title ?? masterResumeRevision(family).title;
  await db.update(creationSessionObjects)
    .set({
      content: { title, resumeFamily: family },
      searchText: title,
      updatedBy: ref.userId,
      updatedAt: sql`now()`,
    })
    .where(eq(creationSessionObjects.id, ref.objectId));
  await registerResume(db, env, { tenantId: ref.tenantId, objectId: ref.objectId, title });
}
