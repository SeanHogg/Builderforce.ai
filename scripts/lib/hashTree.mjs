/**
 * The ONE tree walk and file hash behind every "did these inputs change?" digest here:
 * `clients/vscode/buildId.mjs` (the build id), `scripts/ensure-linked-builds.mjs` (the linked
 * packages' dist stamps) and `clients/vscode/webview/buildInputs.mjs` (the webview build stamp).
 * Each keeps its own digest FORMAT (changing one would invalidate its stamps for no reason); what
 * they share is how files are found and read.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** sha256 hex of a file's bytes. Throws when it cannot be read. */
export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * The files under `dir`, depth first, entries of each directory in name order. A missing `dir`
 * yields nothing; any other read error throws.
 *
 * @param {string} dir
 * @param {{ skipDirs?: Set<string>, accept?: (name: string) => boolean, includeSymlinks?: boolean }} [options]
 *   `skipDirs`: directory names never entered. `accept`: filters FILES by name (directories are always
 *   walked). `includeSymlinks`: yield symlinks as files (default: only real files).
 */
export function* walkFiles(dir, { skipDirs = new Set(), accept, includeSymlinks = false } = {}) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return;
    throw error;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) yield* walkFiles(file, { skipDirs, accept, includeSymlinks });
    } else if ((entry.isFile() || (includeSymlinks && entry.isSymbolicLink())) && (!accept || accept(entry.name))) {
      yield file;
    }
  }
}
