/**
 * The IDE import's baseline record: after the browser SAVED an imported manifest, the
 * paths it saved become (part of) that repo's workspace baseline — so a later push
 * deletes only what was imported and then removed, never a file the import skipped
 * (read in part, past a cap) or failed to save. Tenant-scoped: another tenant's repo
 * is not found.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projectRepositories } from '../../infrastructure/database/schema';
import { recordImportBaseline, type BaselineBucket } from './workspaceRepoBaseline';

export type RecordImportBaselineResult =
  | { ok: true; recorded: number; stored: boolean }
  | { ok: false; status: 400 | 404 | 503; error: string };

export async function recordRepoImportBaseline(
  db: Db,
  bucket: BaselineBucket | undefined,
  tenantId: number,
  repoId: string,
  paths: readonly string[],
): Promise<RecordImportBaselineResult> {
  const [row] = await db
    .select({ projectId: projectRepositories.projectId })
    .from(projectRepositories)
    .where(and(eq(projectRepositories.id, repoId), eq(projectRepositories.tenantId, tenantId)));
  if (!row) return { ok: false, status: 404, error: 'Repository not found' };
  if (row.projectId == null) return { ok: false, status: 400, error: 'Repository is not bound to a project' };
  if (!bucket) return { ok: false, status: 503, error: 'Storage not configured' };
  // Best-effort (reported inside): the files are saved either way.
  const stored = await recordImportBaseline(bucket, row.projectId, repoId, paths);
  return { ok: true, recorded: paths.length, stored };
}
