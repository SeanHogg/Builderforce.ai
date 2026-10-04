/**
 * A project's MEDIA — the images and video clips generated for it, kept so a
 * person can preview them, pick one, and find it again later.
 *
 * Not a new table: a generated picture is a made thing with a kind, which is
 * exactly a `kernel.artifacts` row ("A made object with a kind"). Each row hangs
 * off the project's entry in the object registry (`objects` kind `project`), the
 * same way a canvas file hangs off its board, so the project → media edge is the
 * registry's own containment edge rather than a second project id column.
 *
 * The bytes are not here. The image/video gateway already stores what it makes
 * (tenant R2, or a vendor-hosted URL); a row records WHERE, what made it, and
 * where it is in its life:
 *
 *   rendering  a video job still running (`attrs.jobId`) — the client resumes it
 *   ready      finished and viewable
 *   failed     the job failed (`attrs.error` says why)
 *
 * Whether the app USES an asset is `attrs.usedAt` — set when a person or the agent
 * puts it in the code. Reads are cached per project and dropped on every write.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { artifacts, projects } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { findObject, registerObject } from '../kernel/ObjectRegistry';
import { loadProjectInTenant, projectInTenantCached } from '../project/projectOwnership';

export const PROJECT_MEDIA_KINDS = ['image', 'video'] as const;
export type ProjectMediaKind = (typeof PROJECT_MEDIA_KINDS)[number];

export const PROJECT_MEDIA_STATUSES = ['rendering', 'ready', 'failed'] as const;
export type ProjectMediaStatus = (typeof PROJECT_MEDIA_STATUSES)[number];

/** Newest first; a project's library is a working set, not an archive. */
export const PROJECT_MEDIA_LIST_LIMIT = 120;

export interface ProjectMediaItem {
  id: string;
  kind: ProjectMediaKind;
  status: ProjectMediaStatus;
  prompt: string;
  url: string | null;
  storageKey: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  model: string | null;
  jobId: string | null;
  error: string | null;
  usedAt: string | null;
  createdAt: string;
}

export interface NewProjectMedia {
  kind: ProjectMediaKind;
  status: ProjectMediaStatus;
  prompt: string;
  url?: string | null;
  storageKey?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  model?: string | null;
  jobId?: string | null;
}

export type ProjectMediaPatch = Partial<Pick<NewProjectMedia, 'status' | 'url' | 'storageKey' | 'mimeType' | 'durationSeconds' | 'model' | 'jobId'>> & {
  error?: string | null;
  /** True marks the asset as used in the app now. */
  used?: boolean;
};

interface MediaAttrs {
  url?: string | null;
  prompt?: string;
  model?: string | null;
  jobId?: string | null;
  error?: string | null;
  usedAt?: string | null;
}

type ArtifactRow = typeof artifacts.$inferSelect;

const PROJECT_OBJECT = { kind: 'project', domain: 'delivery' } as const;

function listCacheKey(tenantId: number, projectId: number): string {
  return `project-media:${tenantId}:${projectId}`;
}

function isKind(value: string): value is ProjectMediaKind {
  return (PROJECT_MEDIA_KINDS as readonly string[]).includes(value);
}

function isStatus(value: string): value is ProjectMediaStatus {
  return (PROJECT_MEDIA_STATUSES as readonly string[]).includes(value);
}

/** One row as the client reads it. Exported for its test. */
export function projectMediaView(row: ArtifactRow): ProjectMediaItem {
  const attrs = (row.attrs ?? {}) as MediaAttrs;
  return {
    id: row.id,
    kind: isKind(row.kind) ? row.kind : 'image',
    status: isStatus(row.status) ? row.status : 'ready',
    prompt: attrs.prompt ?? row.title,
    url: attrs.url ?? null,
    storageKey: row.storageKey ?? null,
    mimeType: row.mime ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    durationSeconds: row.durationMs != null ? row.durationMs / 1000 : null,
    model: attrs.model ?? null,
    jobId: attrs.jobId ?? null,
    error: attrs.error ?? null,
    usedAt: attrs.usedAt ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The project's media, newest first; null when the project is not this tenant's.
 *  A project with no registry entry yet simply has none. */
export async function listProjectMedia(env: Env, db: Db, tenantId: number, projectId: number): Promise<ProjectMediaItem[] | null> {
  if (!(await projectInTenantCached(env, db, tenantId, projectId))) return null;
  return getOrSetCached(env, listCacheKey(tenantId, projectId), async () => {
    const owner = await findObject(db, tenantId, PROJECT_OBJECT.kind, projectId);
    if (!owner) return [];
    const rows = await db.select().from(artifacts)
      .where(scopedToTenant(artifacts, tenantId, eq(artifacts.objectId, owner.id), inArray(artifacts.kind, [...PROJECT_MEDIA_KINDS])))
      .orderBy(desc(artifacts.createdAt))
      .limit(PROJECT_MEDIA_LIST_LIMIT);
    return rows.map(projectMediaView);
  }, { kvTtlSeconds: 10 * 60, l1TtlMs: 30_000 });
}

/** Null when the project is not this tenant's. */
export async function recordProjectMedia(
  env: Env,
  db: Db,
  input: { tenantId: number; projectId: number; userId: string | null; media: NewProjectMedia },
): Promise<ProjectMediaItem | null> {
  const project = await loadProjectInTenant(db, input.tenantId, input.projectId, { name: projects.name });
  if (!project) return null;
  const owner = await registerObject(db, env, {
    tenantId: input.tenantId,
    kind: PROJECT_OBJECT.kind,
    refId: input.projectId,
    domain: PROJECT_OBJECT.domain,
    title: project.name,
  });
  const { media } = input;
  const attrs: MediaAttrs = {
    prompt: media.prompt,
    url: media.url ?? null,
    model: media.model ?? null,
    jobId: media.jobId ?? null,
  };
  const [row] = await db.insert(artifacts).values({
    tenantId: input.tenantId,
    objectId: owner.id,
    kind: media.kind,
    title: media.prompt.slice(0, 300),
    mime: media.mimeType ?? null,
    storageKey: media.storageKey ?? null,
    width: media.width ?? null,
    height: media.height ?? null,
    durationMs: media.durationSeconds != null ? Math.round(media.durationSeconds * 1000) : null,
    status: media.status,
    attrs,
    createdBy: input.userId,
  }).returning();
  await invalidateCached(env, listCacheKey(input.tenantId, input.projectId));
  return projectMediaView(row!);
}

/** Null when no such asset belongs to this project. */
export async function updateProjectMedia(
  env: Env,
  db: Db,
  input: { tenantId: number; projectId: number; mediaId: string; patch: ProjectMediaPatch },
): Promise<ProjectMediaItem | null> {
  const row = await loadOwnedRow(db, input.tenantId, input.projectId, input.mediaId);
  if (!row) return null;
  const { patch } = input;
  const attrs: MediaAttrs = { ...((row.attrs ?? {}) as MediaAttrs) };
  if (patch.url !== undefined) attrs.url = patch.url;
  if (patch.model !== undefined) attrs.model = patch.model;
  if (patch.jobId !== undefined) attrs.jobId = patch.jobId;
  if (patch.error !== undefined) attrs.error = patch.error;
  if (patch.used) attrs.usedAt = new Date().toISOString();
  const [updated] = await db.update(artifacts).set({
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.storageKey !== undefined ? { storageKey: patch.storageKey } : {}),
    ...(patch.mimeType !== undefined ? { mime: patch.mimeType } : {}),
    ...(patch.durationSeconds !== undefined ? { durationMs: patch.durationSeconds != null ? Math.round(patch.durationSeconds * 1000) : null } : {}),
    attrs,
    updatedAt: new Date(),
  }).where(scopedToTenant(artifacts, input.tenantId, eq(artifacts.id, row.id))).returning();
  await invalidateCached(env, listCacheKey(input.tenantId, input.projectId));
  return updated ? projectMediaView(updated) : null;
}

/** Removes the library entry. The stored bytes stay: the app may already link to them. */
export async function removeProjectMedia(
  env: Env,
  db: Db,
  input: { tenantId: number; projectId: number; mediaId: string },
): Promise<boolean> {
  const row = await loadOwnedRow(db, input.tenantId, input.projectId, input.mediaId);
  if (!row) return false;
  await db.delete(artifacts).where(scopedToTenant(artifacts, input.tenantId, eq(artifacts.id, row.id)));
  await invalidateCached(env, listCacheKey(input.tenantId, input.projectId));
  return true;
}

async function loadOwnedRow(db: Db, tenantId: number, projectId: number, mediaId: string): Promise<ArtifactRow | null> {
  const owner = await findObject(db, tenantId, PROJECT_OBJECT.kind, projectId);
  if (!owner) return null;
  const [row] = await db.select().from(artifacts)
    .where(scopedToTenant(artifacts, tenantId, and(eq(artifacts.id, mediaId), eq(artifacts.objectId, owner.id), inArray(artifacts.kind, [...PROJECT_MEDIA_KINDS]))))
    .limit(1);
  return row ?? null;
}
