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
import { isRetiredScaffold, scaffoldForModality, scaffoldPathStoodInFor } from '@builderforce/ide-templates';
import { validateFileContentForPath } from '@builderforce/ide-file-contract';

/** Why a scaffold file was restored. `retired` = untouched starter from an older scaffold. */
export type ScaffoldRestoreReason = 'empty' | 'corrupt' | 'retired';

export interface ScaffoldRepairResult {
  /** The file map with empty/corrupt/retired scaffold files replaced by the template. */
  repaired: Record<string, string>;
  /** Scaffold paths that were restored, and why — for logging + persistence. */
  restored: { path: string; reason: ScaffoldRestoreReason }[];
}

/**
 * Repair the scaffold files in `files` for the given modality. Non-scaffold files
 * (the user's own extra files) are passed through untouched, and a modality that
 * owns no scaffold (the generative ones, which never run the Vite app) is
 * returned unchanged rather than having a web app forced onto it.
 */
export function repairScaffold(
  files: Record<string, string>,
  modality: string,
): ScaffoldRepairResult {
  const defaults = scaffoldForModality(modality);
  if (!defaults) return { repaired: { ...files }, restored: [] };
  const repaired: Record<string, string> = { ...files };
  const restored: { path: string; reason: ScaffoldRestoreReason }[] = [];

  for (const [path, template] of Object.entries(defaults)) {
    const current = repaired[path];
    // A MISSING file the project already supplies under another extension stays missing.
    if (current === undefined && scaffoldPathStoodInFor(path, Object.keys(repaired))) continue;
    const reason = restoreReason(path, current);
    if (reason) {
      repaired[path] = template;
      restored.push({ path, reason });
    }
  }

  return { repaired, restored };
}

function restoreReason(path: string, current: string | undefined): ScaffoldRestoreReason | null {
  if (!current || current.trim() === '') return 'empty';
  // A non-empty scaffold file that fails ITS OWN structural contract is
  // cross-wired content (another file written here).
  if (!validateFileContentForPath(path, current).ok) return 'corrupt';
  // Untouched starter from an older scaffold — e.g. the entry that rendered its own
  // inline App and so never showed the app written into src/App.jsx.
  if (isRetiredScaffold(path, current)) return 'retired';
  return null;
}
