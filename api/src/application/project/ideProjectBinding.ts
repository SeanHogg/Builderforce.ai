/**
 * Binding an EXISTING project to a build record (`ide_projects` row).
 *
 * `POST /api/ide-projects` always mints its own storage project. A project born in
 * Studio already has one (`createProject({ origin: 'studio' })`) and no build
 * record, so the canvas, which places builds, had nothing to open. Binding gives
 * that project the record in place: its files, chats and listing stay where they
 * are, and `is_ide_storage` is left alone (it is a real project, so deleting the
 * build later only unlinks it, which the delete route already handles).
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { ideProjects, projects } from '../../infrastructure/database/schema';
import { loadProjectInTenant } from './projectOwnership';

/** The IDE modalities an IDE project can be — must stay in step with the frontend's
 *  `lib/modality.ts` registry, since an id missing here is silently downgraded to
 *  `designer` (which is how `webmobile` projects lost their Mobile identity).
 *  `llm` is the retired combined modality, accepted for backward compatibility
 *  (the frontend aliases it to `evermind`). */
export const IDE_MODALITIES = new Set(['designer', 'mobile', 'webmobile', 'video', 'evermind', 'finetune', 'voice', 'llm']);

export function toIdeModality(value: string | null | undefined): string {
  return value && IDE_MODALITIES.has(value) ? value : 'designer';
}

export type IdeBinding = { id: number; created: boolean };

/**
 * The build record for `storageProjectId`, creating it when the project has none.
 * `null` when the project is not the tenant's. Idempotent under a race: the unique
 * `storage_project_id` makes a second insert a no-op, and the re-read returns the
 * winner's row.
 */
export async function ensureIdeProjectForStorage(db: Db, tenantId: number, storageProjectId: number): Promise<IdeBinding | null> {
  const existing = await findBinding(db, tenantId, storageProjectId);
  if (existing != null) return { id: existing, created: false };
  const project = await loadProjectInTenant(db, tenantId, storageProjectId, {
    id: projects.id, name: projects.name, modality: projects.modality, segmentId: projects.segmentId,
  });
  if (!project) return null;
  const [inserted] = await db
    .insert(ideProjects)
    .values({
      tenantId,
      segmentId: project.segmentId ?? null,
      storageProjectId: project.id,
      name: project.name,
      modality: toIdeModality(project.modality),
    })
    .onConflictDoNothing({ target: ideProjects.storageProjectId })
    .returning({ id: ideProjects.id });
  if (inserted) return { id: inserted.id, created: true };
  const raced = await findBinding(db, tenantId, storageProjectId);
  return raced == null ? null : { id: raced, created: false };
}

async function findBinding(db: Db, tenantId: number, storageProjectId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: ideProjects.id, tenantId: ideProjects.tenantId })
    .from(ideProjects)
    .where(eq(ideProjects.storageProjectId, storageProjectId))
    .limit(1);
  // A row under another tenant is not this caller's to see or bind.
  return row && row.tenantId === tenantId ? row.id : null;
}
