/**
 * What `/launch`'s argument names (PRD 31 §W11): the workspace's own app (nothing, a subcommand
 * or a manifest environment — `launch.ts`'s original flow), or a PATH the person typed:
 * - an existing `.html`/`.htm` FILE → a `page`: its directory is the project, the file is shown at `/`;
 * - an existing DIRECTORY → a `folder` launched as the project when it has a manifest; else its
 *   `index.html`/`index.htm` as a `page` (the same target as typing that file); else a `folder`
 *   the app is detected in;
 * - any other existing file → `notPage` (refused: only HTML pages launch);
 * - a path-looking argument with nothing there → `missing`.
 * A relative path is tried against every workspace folder. Pure over the workspace port.
 */
import * as path from "node:path";
import { LAUNCH_SUBCOMMANDS } from "./entries";
import { findFolderManifest } from "./manifestLocation";
import type { ComposerWorkspacePort } from "./workspacePort";

/** The page files a folder launches when it has no manifest, in order of preference. */
export const INDEX_PAGE_NAMES: readonly string[] = ["index.html", "index.htm"];

/** A launchable HTML page's name. */
export const HTML_PAGE = /\.html?$/i;

/** The folder's index page among its top-level names: the first of {@link INDEX_PAGE_NAMES} (case-insensitive), `.html` before `.htm`. */
export function findIndexPage(names: readonly string[]): string | undefined {
  for (const wanted of INDEX_PAGE_NAMES) {
    const found = names.filter((name) => name.toLowerCase() === wanted).sort()[0];
    if (found !== undefined) return found;
  }
  return undefined;
}

export type LaunchTarget =
  /** No path: the workspace folder's app (the argument, if any, is a subcommand or an environment). */
  | { kind: "workspace" }
  /** A page of a project directory: shown at `/` as `page` (POSIX, leading `/`). */
  | { kind: "page"; projectDir: string; page: string }
  /** A directory launched as a project: its manifest, else detection (it has no index page). */
  | { kind: "folder"; projectDir: string; hasManifest: boolean }
  /** A file that is not an HTML page. */
  | { kind: "notPage"; file: string }
  | { kind: "missing"; argument: string };

/**
 * An environment name is an id (`staging`); anything with a separator, a drive, or a dot
 * (`mockup.html`, `.design`) is a path.
 */
const looksLikePath = (argument: string): boolean => /[\\/]|^[A-Za-z]:|\./.test(argument);

/** The absolute paths a typed path may mean: itself, or under each workspace folder. */
function candidates(port: ComposerWorkspacePort, argument: string): string[] {
  const clean = (file: string): string => {
    const normal = path.normalize(file);
    return normal.length > 1 && /[\\/]$/.test(normal) && path.dirname(normal) !== normal ? normal.slice(0, -1) : normal;
  };
  return path.isAbsolute(argument) ? [clean(argument)] : port.folders().map((folder) => clean(path.join(folder.path, argument)));
}

/** The file a `page` target shows (its project directory + page). */
export const pageFile = (target: { projectDir: string; page: string }): string => path.join(target.projectDir, ...target.page.split("/"));

/** The key a target's launcher is held under (`FolderLaunchers`): its own path, so `/launch <dir>` and `/launch <dir>/index.html` share one. */
export function launcherKey(target: Extract<LaunchTarget, { kind: "page" | "folder" }>): string {
  const key = target.kind === "page" ? pageFile(target) : target.projectDir;
  return process.platform === "win32" ? key.toLowerCase() : key;
}

async function directoryTarget(port: ComposerWorkspacePort, directory: string): Promise<LaunchTarget> {
  const folder = { name: path.basename(directory) || directory, path: directory };
  if (await findFolderManifest(port, folder)) return { kind: "folder", projectDir: directory, hasManifest: true };
  const index = findIndexPage(await port.listDir(directory));
  return index === undefined ? { kind: "folder", projectDir: directory, hasManifest: false } : { kind: "page", projectDir: directory, page: `/${index}` };
}

export async function resolveLaunchTarget(port: ComposerWorkspacePort, argument: string | undefined): Promise<LaunchTarget> {
  if (argument === undefined || LAUNCH_SUBCOMMANDS.has(argument) || !looksLikePath(argument)) return { kind: "workspace" };
  for (const candidate of candidates(port, argument)) {
    const kind = await port.stat(candidate);
    if (kind === "directory") return directoryTarget(port, candidate);
    if (kind === "file") {
      return HTML_PAGE.test(candidate)
        ? { kind: "page", projectDir: path.dirname(candidate), page: `/${path.basename(candidate)}` }
        : { kind: "notPage", file: candidate };
    }
  }
  return { kind: "missing", argument };
}
