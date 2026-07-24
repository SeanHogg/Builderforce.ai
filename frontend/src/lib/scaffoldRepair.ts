/**
 * Scaffold repair — make a project's file set RUNNABLE before it is mounted into
 * the WebContainer, regardless of how the on-disk copy got damaged.
 *
 * A Designer/Mobile workspace can reach Run in a broken state: a scaffold file
 * empty (never seeded, or a 0-byte placeholder) or STRUCTURALLY CROSS-WIRED —
 * another file's content written to the wrong path (package.json's JSON in
 * vite.config.js, vite.config.js's source in index.html, …). Vite then fails to
 * boot, or the browser serves raw source as the "page".
 *
 * This is the single source of truth for that repair, shared by Run/Check/publish
 * (the component used to inline the loop). It is a PURE function so it can be unit
 * tested exhaustively without a WebContainer or React: given the gathered file
 * map and the modality, it returns a repaired map plus the paths it restored, so
 * the caller can both mount the repaired set AND persist the corrections back.
 *
 * Safety: it only ever restores a scaffold path that is empty or FAILS its
 * structural contract ({@link validateFileContentForPath}). A file that has valid
 * content for its own path is never touched, so real user work is preserved.
 */
import { defaultsForModality } from './vanillaDefaults';
import { validateFileContentForPath } from './fileContentGuard';

export interface ScaffoldRepairResult {
  /** The file map with empty/corrupt scaffold files replaced by the template. */
  repaired: Record<string, string>;
  /** Scaffold paths that were restored, and why — for logging + persistence. */
  restored: { path: string; reason: 'empty' | 'corrupt' }[];
}

/**
 * Repair the scaffold files in `files` for the given modality. Non-scaffold files
 * (the user's own extra files) are passed through untouched.
 */
export function repairScaffold(
  files: Record<string, string>,
  modality: string,
): ScaffoldRepairResult {
  const defaults = defaultsForModality(modality);
  const repaired: Record<string, string> = { ...files };
  const restored: { path: string; reason: 'empty' | 'corrupt' }[] = [];

  for (const [path, template] of Object.entries(defaults)) {
    const current = repaired[path];
    const isEmpty = !current || current.trim() === '';
    // A non-empty scaffold file that fails ITS OWN structural contract is
    // cross-wired content (another file written here). Restore it.
    const isCorrupt = !isEmpty && !validateFileContentForPath(path, current).ok;
    if (isEmpty || isCorrupt) {
      repaired[path] = template;
      restored.push({ path, reason: isEmpty ? 'empty' : 'corrupt' });
    }
  }

  return { repaired, restored };
}
