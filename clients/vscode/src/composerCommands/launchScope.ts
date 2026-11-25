/**
 * What launching a directory exposes: the launcher serves the WHOLE project directory to the page
 * (and its watcher streams it), so where it is matters.
 * - inside a workspace folder (real paths compared): launched directly;
 * - outside every workspace folder: the person approves it first, naming the directory;
 * - a file system / drive root, or the user's home directory itself: never.
 * The REAL path comes back with the verdict: it is what will be served, so it is what replies name.
 */
import * as path from "node:path";
import { sameDirectory } from "./launchTarget";
import type { ComposerWorkspacePort } from "./workspacePort";

export interface LaunchScope {
  scope: "inside" | "outside" | "root" | "home";
  /** The directory with every link resolved. */
  real: string;
}

export async function launchScope(port: ComposerWorkspacePort, directory: string, home: string): Promise<LaunchScope> {
  const real = await port.realPath(directory);
  if (path.parse(real).root === real) return { scope: "root", real };
  if (await sameDirectory(port, real, home)) return { scope: "home", real };
  for (const folder of port.folders()) {
    const root = await port.realPath(folder.path);
    const relative = path.relative(root, real);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) return { scope: "inside", real };
  }
  return { scope: "outside", real };
}
