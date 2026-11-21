/**
 * Where a workspace folder's app manifest lives (PRD 49): `.builderforce/builderforce.json`.
 * A root `builderforce.json` / `bfwc.app.json` an older version left is read as a fallback and
 * never written; `/manifest move` moves it into `.builderforce/`.
 *
 * The names are the runtime's (`@seanhogg/builderforce-webcontainers/manifest`), the same
 * constants its launcher reads with — never a second copy here.
 */
import * as path from "node:path";
import { LEGACY_MANIFEST_FILES, MANIFEST_FILE, WORKSPACE_DIR } from "@seanhogg/builderforce-webcontainers/manifest";
import { inFolder, type ComposerWorkspacePort, type WorkspaceFolderRef } from "./workspacePort";

export { LEGACY_MANIFEST_FILES, MANIFEST_FILE, WORKSPACE_DIR };

/** The manifest's folder-relative POSIX path: the ONLY path the extension writes. */
export const MANIFEST_PATH = `${WORKSPACE_DIR}/${MANIFEST_FILE}`;

/** Every path a reader tries, canonical first, then each legacy root file. */
export const MANIFEST_READ_ORDER: readonly string[] = [MANIFEST_PATH, ...LEGACY_MANIFEST_FILES];

export interface FolderManifest {
  /** Absolute path. */
  file: string;
  /** Folder-relative POSIX path (`.builderforce/builderforce.json`, or a legacy root name). */
  relative: string;
  /** A root file an older version wrote: read, never written; `/manifest move` moves it. */
  legacy: boolean;
}

/**
 * The folder's manifest: the canonical file when present, else the first legacy root file;
 * undefined when it has none. `order` narrows the search (`LEGACY_MANIFEST_FILES`: a root file only).
 */
export async function findFolderManifest(
  port: ComposerWorkspacePort,
  folder: WorkspaceFolderRef,
  order: readonly string[] = MANIFEST_READ_ORDER,
): Promise<FolderManifest | undefined> {
  for (const relative of order) {
    const file = inFolder(folder, relative);
    if (await port.exists(file)) return { file, relative, legacy: relative !== MANIFEST_PATH };
  }
  return undefined;
}

const samePath = (a: string, b: string): boolean => {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/**
 * Is this file a workspace folder's manifest — `<folder>/.builderforce/builderforce.json` or a
 * legacy root file — and not one nested in `node_modules` or a sub-app?
 */
export function isFolderManifest(file: string, roots: readonly string[]): boolean {
  return roots.some((root) => MANIFEST_READ_ORDER.some((relative) => samePath(file, path.join(root, ...relative.split("/")))));
}
