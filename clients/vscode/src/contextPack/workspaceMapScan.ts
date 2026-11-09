/**
 * The walk behind the WORKSPACE MAP (`workspaceMap.ts`) and its per-session cache.
 *
 * A bounded breadth-first walk of the open folder for the folders that hold a
 * `package.json`, a lockfile or a `pnpm-workspace.yaml`. It skips what every workspace
 * walk skips (`isSkippedDirName`: node_modules, dist, .git, …), dot folders, and a
 * package's own source/test folders (packages do not nest there).
 *
 * Computed ONCE per root and cached. The cache is checked on each read by one stat pass
 * over what the walk saw: every walked folder (a folder's mtime moves when an entry is
 * added or removed — a new package.json or lockfile) and every manifest, lockfile and
 * workspace file (an edit moves its mtime or size). Any change ⇒ the next read re-walks.
 *
 * Pure Node (no `vscode` import), so the test drives it over a fixture tree.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isSkippedDirName } from "@builderforce/agent-tools/knowledge";
import { LOCKFILE_MANAGERS, PNPM_WORKSPACE_FILE, readPackageJson, renderWorkspaceMap, type PackageDir } from "./workspaceMap";

/** Folder levels below the root the walk descends. `a/b/extensions/x` is 4. */
export const WORKSPACE_MAP_MAX_DEPTH = 5;
/** Folders the walk visits at most — a backstop for a huge open folder. */
const MAX_DIRS = 5_000;
/** Inside a package, folders that hold its code, never another package. */
const PACKAGE_INTERNAL_DIRS: ReadonlySet<string> = new Set(["src", "test", "tests", "__tests__", "__fixtures__", "fixtures", "e2e", "lib", "public", "assets"]);

export interface WorkspaceMapSnapshot {
  dirs: PackageDir[];
  /** Absolute path → `mtimeMs:size` for every folder walked and every file read. */
  stamps: Map<string, string>;
}

const stampOf = (st: { mtimeMs: number; size: number; isDirectory(): boolean }): string => (st.isDirectory() ? `${st.mtimeMs}` : `${st.mtimeMs}:${st.size}`);

async function statStamp(abs: string): Promise<string | undefined> {
  try {
    return stampOf(await fs.stat(abs));
  } catch {
    return undefined;
  }
}

/** One folder: what it holds of interest, and the child folders to walk next. */
async function visit(root: string, rel: string, stamps: Map<string, string>): Promise<{ dir?: PackageDir; children: string[] }> {
  const abs = rel ? path.join(root, ...rel.split("/")) : root;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return { children: [] };
  }
  const stamp = await statStamp(abs);
  if (stamp) stamps.set(abs, stamp);
  const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const hasManifest = files.has("package.json");
  const lockfiles = Object.keys(LOCKFILE_MANAGERS).filter((l) => files.has(l));
  const pnpmWorkspace = files.has(PNPM_WORKSPACE_FILE);
  const children = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !isSkippedDirName(e.name) && !(hasManifest && PACKAGE_INTERNAL_DIRS.has(e.name)))
    .map((e) => (rel ? `${rel}/${e.name}` : e.name));
  if (!hasManifest && lockfiles.length === 0 && !pnpmWorkspace) return { children };

  const tracked = [...(hasManifest ? ["package.json"] : []), ...lockfiles, ...(pnpmWorkspace ? [PNPM_WORKSPACE_FILE] : [])];
  await Promise.all(tracked.map(async (f) => {
    const s = await statStamp(path.join(abs, f));
    if (s) stamps.set(path.join(abs, f), s);
  }));
  const pkg = hasManifest
    ? readPackageJson(await fs.readFile(path.join(abs, "package.json"), "utf8").catch(() => ""))
    : { scripts: [], declaresWorkspaces: false };
  return { dir: { path: rel, hasManifest, ...pkg, lockfiles, pnpmWorkspace }, children };
}

/** Walk `root` for its package folders, breadth-first, bounded by depth and folder count. */
export async function scanWorkspacePackages(root: string, maxDepth: number = WORKSPACE_MAP_MAX_DEPTH): Promise<WorkspaceMapSnapshot> {
  const stamps = new Map<string, string>();
  const dirs: PackageDir[] = [];
  let level = [""];
  let visited = 0;
  for (let d = 0; d <= maxDepth && level.length > 0 && visited < MAX_DIRS; d++) {
    const batch = level.slice(0, MAX_DIRS - visited);
    visited += batch.length;
    const results = await Promise.all(batch.map((rel) => visit(root, rel, stamps)));
    for (const r of results) if (r.dir) dirs.push(r.dir);
    level = results.flatMap((r) => r.children);
  }
  return { dirs, stamps };
}

/** True when nothing the walk saw has changed since. */
export async function snapshotIsFresh(snapshot: WorkspaceMapSnapshot): Promise<boolean> {
  const checks = await Promise.all([...snapshot.stamps].map(async ([abs, stamp]) => (await statStamp(abs)) === stamp));
  return checks.every(Boolean);
}

interface Cached {
  snapshot: WorkspaceMapSnapshot;
  text: string;
}

const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<string>>();

async function compute(root: string): Promise<string> {
  const hit = cache.get(root);
  if (hit && (await snapshotIsFresh(hit.snapshot))) return hit.text;
  const snapshot = await scanWorkspacePackages(root);
  const text = renderWorkspaceMap(snapshot.dirs);
  cache.set(root, { snapshot, text });
  return text;
}

/**
 * The rendered map for `root` ('' when it holds no package) — walked once, then served
 * from the cache until something it saw changes. One computation in flight per root:
 * a read while one runs shares it (a pack that gave up on it at its deadline still
 * leaves the result cached for the next run).
 */
export function workspaceMapFor(root: string): Promise<string> {
  if (!root) return Promise.resolve("");
  const inFlight = pending.get(root);
  if (inFlight) return inFlight;
  const work = compute(root)
    .catch(() => "")
    .finally(() => {
      if (pending.get(root) === work) pending.delete(root);
    });
  pending.set(root, work);
  return work;
}

/** Forget `root` (every root when omitted) — for a host that watches manifests itself. */
export function invalidateWorkspaceMap(root?: string): void {
  if (root === undefined) cache.clear();
  else cache.delete(root);
}
