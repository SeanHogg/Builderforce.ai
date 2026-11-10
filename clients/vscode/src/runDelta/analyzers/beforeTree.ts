/**
 * The run's BEFORE tree, materialized for the whole-tree analyzers (PRD 41 §6 "Agent run" step 4) only as a FALLBACK,
 * when their cache misses: git's file list of the working tree (`git ls-files --cached --others --exclude-standard`)
 * hard-linked into a private folder on the repository's own volume (`<root>/.builderforce/cache/`, which git and every
 * after-side tool ignore), with the run's IN-RUN changed files swapped to their before text — the same "after with the
 * in-run files swapped" definition the facts port uses (`DeltaPorts.facts`). A file the run created is absent; one whose
 * before side could not be read keeps its after bytes (its findings are `present` anyway).
 *
 * ONE FILE UNIVERSE. The before tree holds git's list only; {@link ignoredFolders} names what git ignores in the after
 * tree (build output), and the tools exclude those there too.
 *
 * DEPENDENCIES. Each package folder's `node_modules` is rebuilt as a folder of links: an entry that resolves INTO the
 * repository (a pnpm/yarn workspace package) points at the SAME package inside the before tree, never at the working
 * tree's (the after side); any other entry is linked to the installed package as it is.
 *
 * READ-ONLY. Files a tool can write (`*.tsbuildinfo`, caches) are copied, never linked, so a write can never reach the
 * working tree; {@link MaterializedTree.changedSince} says whether a linked file changed while the tools ran (the caller
 * then does not cache). Any copy error fails the whole tree. Dispose removes the links first, so a delete never walks
 * into a real `node_modules`; {@link sweepOrphanedTrees} does the same for trees an earlier session left behind.
 */

import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { PreparedDelta } from "../preparedPorts";
import { whichOnPath } from "./nodeAnalyzerExec";
import { pool } from "./pool";

export const MAX_TREE_FILES = 60_000;
const LIST_TIMEOUT_MS = 30_000;
/** Where the trees live, under the repository: on its volume (hard links work) and ignored (`.builderforce/cache/.gitignore`). */
export const TREE_PARENT = [".builderforce", "cache"] as const;
export const TREE_PREFIX = "delta-before-";
/** `copy`-mode trees (and the analyzers' scratch folders): `<os temp>/bf-delta-*`, outside every repository. */
export const COPY_PREFIX = "bf-delta-";
/** The `node_modules` dot-entries a `copy` tree shares with the working tree (the package store); every other is its own. */
const SHARED_DOT_ENTRY = /^\.(?:bin|pnpm)$/;
/** Orphans older than this are swept at activation. */
const ORPHAN_AGE_MS = 60 * 60_000;
/** Files a tool may write: copied, never linked. */
const WRITABLE = /(?:\.tsbuildinfo|\.eslintcache|\.cache)$/i;

export interface BeforeTreeFile {
  /** Root-relative POSIX path. */
  path: string;
  /** Before text; undefined = the file did not exist before the run. `unknown` = its before side could not be read. */
  text?: string;
  unknown?: boolean;
}

/**
 * How the tree's files are placed: `link` (hard links; writable caches copied) for the READ-ONLY L3 analyzers; `copy`
 * for a tree in which project code RUNS (the dynamic tier's tests, benchmarks and StrykerJS).
 */
export type TreeMode = "link" | "copy";

export interface MaterializedTree {
  dir: string;
  /** Whether a linked working-tree file changed since the tree was built (its result must not be cached). */
  changedSince(): Promise<boolean>;
  dispose(): Promise<void>;
}

/**
 * The run's IN-RUN changed files as the before tree swaps them, from the delta's prepared inputs: its before text, absent
 * when the file did not exist, `unknown` when it existed but its before side could not be read. ONE definition for every
 * before tree (the L3 analyzers', the dynamic tier's).
 */
export function beforeTreeFilesOf(prepared: Pick<PreparedDelta, "input" | "texts">): BeforeTreeFile[] {
  const before = new Map(prepared.texts.before);
  return prepared.input.files.filter((f) => f.attribution !== "outside-run").sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((f) => {
    const b = before.get(f.path);
    const text = b && !("reason" in b) ? b.text : undefined;
    const readable = !!b && !("reason" in b);
    return { path: f.path, ...(text !== undefined ? { text } : {}), ...(f.beforeHash !== undefined && !readable ? { unknown: true } : {}) };
  });
}

/** `git -C <root> …` by git's absolute path, from a neutral folder; undefined when git cannot answer. */
async function git(root: string, args: readonly string[]): Promise<string | undefined> {
  const exe = await whichOnPath("git");
  if (!exe) return undefined;
  return new Promise((resolve) => {
    execFile(exe, ["-C", root, "-c", "core.quotepath=false", ...args],
      { cwd: tmpdir(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: LIST_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => resolve(error ? undefined : stdout));
  });
}

/** git's file universe of the working tree (tracked + untracked, not ignored). */
export async function treeFiles(root: string): Promise<string[] | undefined> {
  const out = await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return out === undefined ? undefined : out.split("\0").filter(Boolean);
}

/** Root-relative folders git ignores in the working tree (build output, caches), sorted; `node_modules` and `.builderforce` are always excluded anyway. */
export async function ignoredFolders(root: string): Promise<string[]> {
  const out = await git(root, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"]);
  if (out === undefined) return [];
  return [...new Set(out.split("\0").filter((p) => p.endsWith("/")).map((p) => p.replace(/\/+$/, ""))
    // Our own cache (it appears once a run writes it) and dependency folders are excluded by every tool anyway: listing
    // them would move the run context's hash, so a run's own cache write would change its key.
    .filter((p) => !/(?:^|\/)(?:node_modules|\.builderforce)(?:\/|$)/.test(p)))].sort();
}

/** Removes a tree: every symlink/junction first (never followed), then the rest. */
export async function removeTree(dir: string): Promise<void> {
  const stack = [dir];
  while (stack.length > 0) {
    const at = stack.pop()!;
    const entries = await fs.readdir(at, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = path.join(at, e.name);
      if (e.isSymbolicLink()) await fs.unlink(p).catch(() => fs.rmdir(p).catch(() => undefined));
      else if (e.isDirectory()) stack.push(p);
    }
  }
  await fs.rm(dir, { recursive: true, force: true });
}

const insideRoot = (p: string, root: string): boolean => {
  const rel = path.relative(root, p);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** One `node_modules` rebuilt in the tree: workspace packages point into the tree, everything else at the installed copy. */
async function linkModules(root: string, dir: string, folder: string, mode: TreeMode): Promise<void> {
  const source = path.join(root, folder, "node_modules");
  const target = path.join(dir, folder, "node_modules");
  const entries = async (from: string, to: string, depth: number): Promise<void> => {
    await fs.mkdir(to, { recursive: true });
    for (const e of await fs.readdir(from, { withFileTypes: true })) {
      const src = path.join(from, e.name), dst = path.join(to, e.name);
      if (e.isDirectory() && e.name.startsWith("@") && depth === 0) { await entries(src, dst, 1); continue; }
      // `copy` (code RUNS here): a tool's own cache folder (`.vite`, `.cache`, `.vitest`, …) is a fresh EMPTY folder of the
      // copy, never a link into the user's `node_modules` — only the package store (`.bin`, `.pnpm`) is shared.
      if (mode === "copy" && depth === 0 && e.isDirectory() && e.name.startsWith(".") && !SHARED_DOT_ENTRY.test(e.name)) {
        await fs.mkdir(dst, { recursive: true });
        continue;
      }
      const real = await fs.realpath(src).catch(() => undefined);
      if (!real) continue; // a dangling link: nothing to resolve to
      const stat = await fs.stat(real);
      // A workspace package: the before tree's own copy of it (relative to the repository), never the after side's.
      const linkTo = insideRoot(real, root) && !real.split(path.sep).includes("node_modules") ? path.join(dir, path.relative(root, real)) : real;
      if (stat.isDirectory()) await fs.symlink(linkTo, dst, "junction");
      else await fs.copyFile(real, dst);
    }
  };
  await entries(source, target, 0);
}

async function ensureCacheIgnored(root: string): Promise<string> {
  const parent = path.join(root, ...TREE_PARENT);
  await fs.mkdir(parent, { recursive: true });
  await fs.writeFile(path.join(parent, ".gitignore"), "*\n", { flag: "wx" }).catch(() => undefined);
  return parent;
}

/** The before tree of `root` with `changed` swapped in; undefined when git cannot list it, it is too large, or any copy fails. */
export async function materializeBeforeTree(
  root: string, changed: readonly BeforeTreeFile[], signal?: AbortSignal, mode: TreeMode = "link",
): Promise<MaterializedTree | undefined> {
  const listed = await treeFiles(root);
  if (!listed || listed.length > MAX_TREE_FILES || signal?.aborted) return undefined;
  // `copy`: OUTSIDE the repository (the OS temp folder, `bf-delta-*`, swept at activation), so nothing a tool does in it —
  // a `git` that walks up, a cache, a report — can land in the user's tree. `link`: on the repository's volume (hard links).
  const dir = mode === "copy"
    ? await fs.mkdtemp(path.join(tmpdir(), COPY_PREFIX))
    : await fs.mkdtemp(path.join(await ensureCacheIgnored(root), TREE_PREFIX));
  const dispose = () => removeTree(dir);
  const stamps = new Map<string, number>();
  try {
    const swapped = new Map(changed.map((f) => [f.path, f]));
    await pool(listed.filter((p) => !swapped.has(p) || swapped.get(p)!.unknown), 32, async (p) => {
      if (signal?.aborted) throw new Error("aborted");
      const from = path.join(root, p), to = path.join(dir, p);
      await fs.mkdir(path.dirname(to), { recursive: true });
      // `copy` (project code RUNS in the tree: the dynamic tier): a real copy (a reflink clone where offered), never a
      // link — a test or a mutant that truncates a file must never reach the user's inode.
      if (mode === "copy") { await fs.copyFile(from, to, fsConstants.COPYFILE_FICLONE); return; }
      if (WRITABLE.test(p)) { await fs.copyFile(from, to); return; }
      try {
        await fs.link(from, to);
        stamps.set(from, (await fs.stat(from)).mtimeMs);
      } catch {
        await fs.copyFile(from, to); // a refused link is copied; a copy that fails fails the tree
      }
    });
    for (const f of changed) {
      if (f.unknown || f.text === undefined) continue;
      const to = path.join(dir, f.path);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.writeFile(to, f.text, "utf8");
    }
    const folders = new Set(["", ...listed.filter((p) => p === "package.json" || p.endsWith("/package.json")).map((p) => path.posix.dirname(p)).map((d) => (d === "." ? "" : d))]);
    for (const folder of [...folders].sort()) {
      if (!(await fs.stat(path.join(root, folder, "node_modules")).then((s) => s.isDirectory(), () => false))) continue;
      await linkModules(root, dir, folder, mode);
    }
    if (signal?.aborted) throw new Error("aborted");
    return {
      dir: dir.replace(/\\/g, "/"),
      changedSince: async () => (await pool([...stamps], 32, async ([p, m]) => (await fs.stat(p).then((s) => s.mtimeMs, () => -1)) !== m)).some(Boolean),
      dispose,
    };
  } catch {
    void dispose().catch(() => undefined);
    return undefined;
  }
}

/** At activation: before trees (and scratch folders) an earlier session left, older than an hour, removed links first. */
export async function sweepOrphanedTrees(folders: readonly string[], now = Date.now()): Promise<void> {
  // `bf-delta-` in the OS temp folder: scratch folders AND `copy`-mode trees ({@link COPY_PREFIX}).
  const parents = [...folders.map((f) => ({ dir: path.join(f, ...TREE_PARENT), prefix: TREE_PREFIX })), { dir: tmpdir(), prefix: COPY_PREFIX }];
  for (const { dir, prefix } of parents) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.startsWith(prefix)) continue;
      const p = path.join(dir, e.name);
      const age = now - (await fs.stat(p).then((s) => s.mtimeMs, () => now));
      if (age > ORPHAN_AGE_MS) await removeTree(p).catch(() => undefined);
    }
  }
}
