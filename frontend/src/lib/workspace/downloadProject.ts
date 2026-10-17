/**
 * "Download project": a workspace's SOURCE as a zip, saved by the browser.
 *
 * The files come from the store (`readStoreFiles`), so it is what is saved — on the
 * server for a durable project, in this browser for a guest's. Dependencies and build
 * output are filtered out BEFORE anything is read, so they never cost a request and
 * never bloat the archive; a recipient runs `npm install` like any cloned project.
 *
 * The zip writer (`lib/zipFiles.ts`, over fflate) is imported on demand, so the
 * editor's bundle pays nothing until someone downloads.
 */
import { slugify } from '@builderforce/creation-canvas-contract';
import { downloadBlob } from '@/lib/download';
import { readStoreFiles } from '@/lib/workspace/readStoreFiles';
import { isGeneratedPath } from '@/lib/workspace/generatedPaths';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';

/**
 * Build output a download also leaves out, beyond the shared rule (`isGeneratedPath`:
 * `node_modules`, `dist`, `.git`): CRA's `build/` and Next's `.next/`. Kept here rather
 * than in the shared rule, which also decides what the agent's shell saves back.
 */
const DOWNLOAD_EXCLUDED_DIRECTORIES = ['build', '.next'];

/** True for a workspace-relative path that belongs in the download. */
export function isDownloadableSource(path: string): boolean {
  if (isGeneratedPath(path)) return false;
  const directories = path.split('/').slice(0, -1);
  return !directories.some((segment) => DOWNLOAD_EXCLUDED_DIRECTORIES.includes(segment));
}

/** A file name from a project name: `My App!` → `my-app`. */
export function projectArchiveName(name: string): string {
  return `${slugify(name, { fallback: 'project', foldDiacritics: true, maxLength: 80 })}.zip`;
}

export interface DownloadProjectDeps {
  zip?: (files: Record<string, string>) => Uint8Array<ArrayBuffer> | Promise<Uint8Array<ArrayBuffer>>;
  save?: (blob: Blob, filename: string) => void;
}

const lazyZip = async (files: Record<string, string>) => (await import('@/lib/zipFiles')).zipFiles(files);

/**
 * Zip the workspace's source and hand it to the browser. Resolves with what was
 * packed; rejects when the store cannot be listed or nothing could be read.
 */
export async function downloadProject(
  store: WorkspaceFileStore,
  name: string,
  deps: DownloadProjectDeps = {},
): Promise<{ filename: string; files: number; unreadable: string[] }> {
  const { files, unreadable } = await readStoreFiles(store, isDownloadableSource);
  const count = Object.keys(files).length;
  if (count === 0) throw new Error('The project has no files that could be read.');
  const bytes = await (deps.zip ?? lazyZip)(files);
  const filename = projectArchiveName(name);
  (deps.save ?? downloadBlob)(new Blob([bytes], { type: 'application/zip' }), filename);
  return { filename, files: count, unreadable };
}
