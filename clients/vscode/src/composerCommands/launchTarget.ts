/**
 * What `/launch`'s argument names (PRD 31 §W11). Resolved in this order:
 * 1. no argument, or a subcommand → the workspace flow;
 * 2. a DECLARED environment name (`environments`, every open folder's) → the workspace flow;
 * 3. a path that exists (absolute, else relative to each workspace folder):
 *    - a workspace folder itself → that folder's workspace flow;
 *    - an `.html`/`.htm` FILE → a `page` of its directory (named as it is on disk);
 *    - another directory → a `folder` launched as a project when it has a manifest; else its top-level
 *      `index.html`/`index.htm` as a `page` (the same target as typing that file); else a `folder` to detect in;
 *    - any other file → `notPage`;
 * 4. a path with nothing there → `missing` (`bare`: a dotted name with no separator, which may be a mistyped
 *    environment); a drive-relative (`C:foo`) or root-relative (`\site`, Windows) path → `needsFullPath`;
 * 5. any other name → the workspace flow, where the CHOSEN folder's environments judge it (`launch.ts`).
 * Every page/folder target also carries `via`, the absolute path that was typed, so the launcher can be found
 * again by it. Pure over the workspace port. A launcher's KEY is not decided here (`FolderLaunchers`).
 */
import * as path from "node:path";
import { LAUNCH_SUBCOMMANDS } from "./entries";
import { findFolderManifest } from "./manifestLocation";
import { canonicalKey } from "./realPath";
import type { ComposerWorkspacePort, WorkspaceFolderRef } from "./workspacePort";

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
  /** The workspace folder's app (the argument, if any, is a subcommand or an environment). */
  | { kind: "workspace" }
  /** A path that IS a workspace folder: its workspace flow, on that folder. */
  | { kind: "workspaceFolder"; folder: WorkspaceFolderRef }
  /** A page of a project directory: shown at `/` as `page` (POSIX, leading `/`, the name on disk). */
  | { kind: "page"; projectDir: string; page: string; via: string }
  /** A directory launched as a project: its manifest, else detection (it has no index page). */
  | { kind: "folder"; projectDir: string; hasManifest: boolean; via: string }
  /** A file that is not an HTML page. */
  | { kind: "notPage"; file: string }
  | { kind: "missing"; argument: string; bare: boolean }
  /** A path relative to a drive's current directory, or (Windows) to the current drive's root: no one meaning here. */
  | { kind: "needsFullPath"; argument: string };

export type PathTarget = Extract<LaunchTarget, { kind: "page" | "folder" }>;

/**
 * An environment name is an id (`staging`); anything with a separator, a drive, or a dot
 * (`mockup.html`, `.design`) is a path.
 */
const looksLikePath = (argument: string): boolean => /[\\/]|^[A-Za-z]:|\./.test(argument);

/** `C:foo` (a drive's current directory) or, on Windows, `\site` (the current drive's root): never a path to launch. */
const isPartialPath = (argument: string): boolean =>
  (path.parse(argument).root !== "" && !path.isAbsolute(argument)) || (process.platform === "win32" && /^[\\/](?![\\/])/.test(argument));

/** The absolute paths a typed path may mean: itself, or under each workspace folder. */
export function typedCandidates(port: ComposerWorkspacePort, argument: string): string[] {
  if (isPartialPath(argument)) return [];
  const clean = (file: string): string => {
    const normal = path.normalize(file);
    return normal.length > 1 && /[\\/]$/.test(normal) && path.dirname(normal) !== normal ? normal.slice(0, -1) : normal;
  };
  return path.isAbsolute(argument) ? [clean(argument)] : port.folders().map((folder) => clean(path.join(folder.path, argument)));
}

/** The file a `page` target shows (its project directory + page). */
export const pageFile = (target: { projectDir: string; page: string }): string => path.join(target.projectDir, ...target.page.split("/"));

/**
 * One command-line argument as `/launch` parses it back (the composer tokenizer: `"…"` or `'…'`, no escapes, backslashes
 * literal). Undefined when the value holds both quote characters: no quoting can carry it.
 */
export function quoteCommandArg(value: string): string | undefined {
  if (!value.includes('"')) return `"${value}"`;
  return value.includes("'") ? undefined : `'${value}'`;
}

/** Are these the same directory, links followed? (`realA` is already a real path.) */
export async function sameDirectory(port: ComposerWorkspacePort, realA: string, b: string): Promise<boolean> {
  return canonicalKey(realA) === canonicalKey(await port.realPath(b));
}

async function directoryTarget(port: ComposerWorkspacePort, directory: string): Promise<LaunchTarget> {
  const real = await port.realPath(directory);
  for (const folder of port.folders()) {
    if (await sameDirectory(port, real, folder.path)) return { kind: "workspaceFolder", folder };
  }
  const named = { name: path.basename(directory) || directory, path: directory };
  if (await findFolderManifest(port, named)) return { kind: "folder", projectDir: directory, hasManifest: true, via: directory };
  const index = findIndexPage(await port.listDir(directory));
  return index === undefined
    ? { kind: "folder", projectDir: directory, hasManifest: false, via: directory }
    : { kind: "page", projectDir: directory, page: `/${index}`, via: directory };
}

/** The page's name as it is on disk (`Index.HTML`, not the `index.html` that was typed). */
async function nameOnDisk(port: ComposerWorkspacePort, file: string): Promise<string> {
  const wanted = path.basename(file).toLowerCase();
  return (await port.listDir(path.dirname(file))).find((name) => name.toLowerCase() === wanted) ?? path.basename(file);
}

export async function resolveLaunchTarget(
  port: ComposerWorkspacePort,
  argument: string | undefined,
  environments?: readonly string[],
): Promise<LaunchTarget> {
  if (argument === undefined || LAUNCH_SUBCOMMANDS.has(argument) || environments?.includes(argument)) return { kind: "workspace" };
  if (isPartialPath(argument)) return { kind: "needsFullPath", argument };
  for (const candidate of typedCandidates(port, argument)) {
    const kind = await port.stat(candidate);
    if (kind === "directory") return directoryTarget(port, candidate);
    if (kind === "file") {
      return HTML_PAGE.test(candidate)
        ? { kind: "page", projectDir: path.dirname(candidate), page: `/${await nameOnDisk(port, candidate)}`, via: candidate }
        : { kind: "notPage", file: candidate };
    }
  }
  return looksLikePath(argument) ? { kind: "missing", argument, bare: !/[\\/]|^[A-Za-z]:/.test(argument) } : { kind: "workspace" };
}
