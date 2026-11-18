/**
 * The files a browser run mounts: the project's durable workspace (the same store the
 * editor and the run pipeline read), minus generated paths (`isGeneratedPath`, the one
 * shared rule) — installed dependencies and build output never cost a request. Files
 * the store listed but could not read are returned too, so the run can refuse to
 * start on a partial tree instead of failing somewhere inside it.
 */
import { serverFileStore } from '@/lib/workspace/workspaceFileStore';
import { readStoreFiles } from '@/lib/workspace/readStoreFiles';
import { isGeneratedPath } from '@/lib/workspace/generatedPaths';
import type { RunFiles } from './runTarget';

export async function loadProjectRunFiles(projectId: number | string): Promise<RunFiles> {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) return { files: {}, unreadable: [] };
  return readStoreFiles(serverFileStore(id), (path) => !isGeneratedPath(path));
}
