/**
 * Which folder a knowledge root is (PRD 38 §4.2 `knowledge_scopes.root_id`), in the editor.
 *
 * A workspace folder's root id is THE root-id rule's (`rootIdFor`, agent-tools):
 * `vscode:<repo>` — the checkout's git remote, normalised, so two checkouts of the same
 * repository share it and two same-named folders of different repositories never do —
 * else `vscode:<folder id>` (a hash of the folder's URI). A folder inside it is
 * `<folder root id>:<relative path>`. The mapping is pure over the workspace folders
 * handed in (and the folder's git config), so it is the same rule in the commands, the
 * panel and the PreFetch rows.
 *
 * Root ids were once the folder's NAME (`<name>`, `<name>/<rel>`): {@link legacyRootIdOf}
 * names a root's old id so its local snapshot is migrated on first read, and
 * {@link rootById} still resolves an old id a memento or a chip kept.
 */

import { realpathSync } from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { folderIdOf, repoIdOfRemote, rootIdFor, rootRelOf } from "@builderforce/agent-tools/knowledge";
import { gitOriginUrlSync } from "@builderforce/agent-tools/node-git-remote";
import { isSafeRelative } from "./safePath";

/** The editor's host segment of a root id. */
export const VSCODE_HOST = "vscode";

/** The knowledge-graph root id of a workspace folder. */
export function knowledgeRootId(root: string): string {
  const abs = path.resolve(root);
  return rootIdFor({ host: VSCODE_HOST, repoId: repoIdOfRemote(gitOriginUrlSync(abs)), folderId: folderIdOf(pathToFileURL(abs).href) });
}

/** The pre-`rootIdFor` id of a root (the folder's name, `/<rel>` inside it) — what its local files were named by. */
export function legacyRootIdOf(root: Pick<KnowledgeRoot, "folderPath" | "rel">): string {
  const base = path.basename(path.resolve(root.folderPath)) || "workspace";
  return root.rel ? `${base}/${root.rel}` : base;
}

/** A workspace folder, as the mapping reads it (absolute path). */
export interface WorkspaceFolderRef {
  path: string;
}

export interface KnowledgeRoot {
  rootId: string;
  /** The reviewed folder's own name, or the workspace's. */
  title: string;
  /** Absolute, `/`-separated. */
  rootPath: string;
  /** The workspace folder holding it (where its snapshot lives). */
  folderPath: string;
  /** `rootPath` relative to `folderPath`; '' for the workspace folder itself. */
  rel: string;
}

/** The editor's ONE path comparison (roots, the background indexer's watcher and its editor priorities): `/`-separated, no trailing `/`. */
export const slash = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
/** Paths compare case-insensitively where the file system does (Windows). */
const CASE_INSENSITIVE = process.platform === "win32";
/** A path as a comparison key: slashed, and lower-cased where paths are case-insensitive. */
export const pathKey = (p: string, caseInsensitive: boolean = CASE_INSENSITIVE): string => (caseInsensitive ? slash(p).toLowerCase() : slash(p));
export const same = (a: string, b: string, caseInsensitive: boolean = CASE_INSENSITIVE): boolean =>
  caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
/** `child` is `parent` or under it (both slashed). */
export const inside = (child: string, parent: string, caseInsensitive: boolean = CASE_INSENSITIVE): boolean =>
  same(child, parent, caseInsensitive) || (child.length > parent.length && same(child.slice(0, parent.length + 1), `${parent}/`, caseInsensitive));

const folderName = (folder: string): string => path.basename(folder) || "workspace";

function rootOf(folder: string, rel: string): KnowledgeRoot {
  const base = knowledgeRootId(folder);
  const rootPath = rel ? `${folder}/${rel}` : folder;
  return { rootId: rel ? `${base}:${rel}` : base, title: rel ? rel.slice(rel.lastIndexOf("/") + 1) : folderName(folder), rootPath, folderPath: folder, rel };
}

/** The root for an absolute folder, when it is inside an open workspace folder (the innermost one). */
export function rootForPath(absPath: string, folders: readonly WorkspaceFolderRef[]): KnowledgeRoot | undefined {
  const target = slash(path.resolve(absPath));
  const holder = folders
    .map((f) => slash(path.resolve(f.path)))
    .filter((f) => inside(target, f))
    .sort((a, b) => b.length - a.length)[0];
  if (holder === undefined) return undefined;
  return rootOf(holder, target.slice(holder.length).replace(/^\//, ""));
}

/**
 * The root a workspace-relative folder names: under the FIRST workspace folder ('' = that
 * folder), or — in a multi-root workspace — `<another folder's name>/<path>`.
 */
export function rootForRelative(rel: string, folders: readonly WorkspaceFolderRef[]): KnowledgeRoot | undefined {
  const first = folders[0];
  if (!first) return undefined;
  const clean = slash(rel).replace(/^\.?\/+/, "");
  if (clean.split("/").some((part) => part === "..")) return undefined;
  const [head = "", ...rest] = clean.split("/");
  const other = clean
    ? folders.slice(1).map((f) => slash(path.resolve(f.path))).find((f) => same(folderName(f), head))
    : undefined;
  return other !== undefined ? rootOf(other, rest.join("/")) : rootOf(slash(path.resolve(first.path)), clean);
}

/** How `/review` names a root: relative to the first workspace folder, else `<folder name>/<path>`. */
export function reviewArgumentOf(root: KnowledgeRoot, folders: readonly WorkspaceFolderRef[]): string {
  const first = folders[0] ? slash(path.resolve(folders[0].path)) : undefined;
  if (first !== undefined && same(root.folderPath, first)) return root.rel || ".";
  const name = folderName(root.folderPath);
  return root.rel ? `${name}/${root.rel}` : name;
}

/** The root a root id names (or its legacy name-based id), when one of the open folders is its workspace folder. */
export function rootById(rootId: string, folders: readonly WorkspaceFolderRef[]): KnowledgeRoot | undefined {
  const resolved = folders.map((f) => slash(path.resolve(f.path)));
  for (const folder of resolved) {
    const rel = rootRelOf(knowledgeRootId(folder), rootId);
    if (rel !== undefined) return confined(folder, rel);
  }
  for (const folder of resolved) {
    const legacy = legacyRootIdOf({ folderPath: folder, rel: "" });
    if (rootId === legacy) return rootOf(folder, "");
    if (rootId.startsWith(`${legacy}/`)) return confined(folder, rootId.slice(legacy.length + 1));
  }
  return undefined;
}

/**
 * The root for `rel` under `folder`, only when `rel` cannot leave it. A root id arrives from the webview, so
 * `base:../../x`, `base:C:/x` or a link inside the folder must not name a place outside the workspace folder:
 * the relative path must be safe, and where the folder exists its real path must sit inside the real folder.
 * This is the ONE check, so every op that resolves a root id (symbols, history, fixes, pinpoint, try) has it.
 */
function confined(folder: string, rel: string): KnowledgeRoot | undefined {
  if (rel === "") return rootOf(folder, "");
  if (!isSafeRelative(rel)) return undefined;
  const root = rootOf(folder, slash(rel));
  try {
    const realFolder = slash(realpathSync(folder));
    return inside(slash(realpathSync(root.rootPath)), realFolder) ? root : undefined;
  } catch (error) {
    // A folder that does not exist yet has no link to follow out of the workspace; any other failure refuses.
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? root : undefined;
  }
}


/** The memento slice the reviewed-roots list lives in (`ExtensionContext.workspaceState`). */
export interface RootsMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/** The ONE workspaceState key listing the roots this workspace reviewed (an unlinked folder's scopes). */
export const REVIEWED_ROOTS_KEY = "builderforce.knowledge.roots";

export function reviewedRoots(memento: RootsMemento): string[] {
  const list = memento.get<unknown>(REVIEWED_ROOTS_KEY);
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

export async function rememberRoot(memento: RootsMemento, rootId: string): Promise<void> {
  const list = reviewedRoots(memento);
  if (!list.includes(rootId)) await memento.update(REVIEWED_ROOTS_KEY, [...list, rootId].sort());
}
