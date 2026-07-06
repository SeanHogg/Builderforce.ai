/**
 * The VS Code (local-disk) concretion of the shared `@builderforce/agent-tools`
 * {@link CapabilityProvider} — the editor twin of the cloud Worker/Container and
 * on-prem Node providers. It lets the SAME shared `ToolDefinition`s
 * (`read_file`/`write_file`/`edit_file`/`delete_file`/`list_files`/`search_code`/
 * `run_command`/`git_*`) run in the editor against the open workspace folder, so the
 * VS Code Brain advertises the EXACT same tools as the cloud Brain — one definition,
 * not a second hand-rolled copy.
 *
 * Where the cloud provider commits over the git API and greps a server-side index,
 * this one writes to disk and walks the workspace; where the cloud has a container
 * shell, this shells out via `child_process`. Every path is resolved INSIDE the
 * workspace root and a traversal escape is rejected, so the provider is self-guarding.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { filterByGlob } from "@builderforce/agent-tools";
import type {
  Capability,
  CapabilityProvider,
  RepoDeleteResult,
  RepoEditResult,
  RepoListResult,
  RepoReadResult,
  RepoSearchResult,
  RepoWriteResult,
  ShellResult,
} from "@builderforce/agent-tools";

const execAsync = promisify(exec);

// Bound the bytes pulled off disk per read. The shared `read_file` tool paginates the
// returned content into line windows, and an oversized file returns a truncated PREFIX
// (never a hard failure), so this only caps how much a single read loads into memory.
const MAX_READ_BYTES = 2 * 1024 * 1024;
// run_command: bound a command's wall-clock + the output handed back to the model.
const RUN_TIMEOUT_MS = 120_000;
const RUN_MAX_BUFFER = 4 * 1024 * 1024;
const RUN_MAX_OUTPUT = 60_000;
// Walks (list_files / search_code): keep bounded so a huge repo can't hang the host.
const LIST_MAX_FILES = 5_000;
// list_files also bounds what it hands BACK to the model: a raw dump of a big monorepo
// floods the context (the failure that made the Brain drown on an unscoped root
// listing). Over this many files we collapse the result to a deduped directory summary
// + truncated flag, so the model narrows with a subdir or search_code instead.
const LIST_RETURN_MAX = 400;
const SEARCH_MAX_MATCHES = 100;
const SEARCH_MAX_FILES = 4_000;
const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".turbo", ".vercel", ".cache",
]);

/** The capabilities the editor surface can physically back: read/search/write/edit/
 *  delete the open folder, plus a real shell (so `run_command` + the `git_*` tools
 *  are offered, identical to the cloud Container). */
export const LOCAL_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  "repo.read", "repo.search", "repo.write", "repo.edit", "repo.delete", "shell",
]);

/** Resolve `rel` under `root`, rejecting any path that escapes the workspace. */
function resolveInRoot(root: string, rel: unknown): string {
  if (typeof rel !== "string") throw new Error("a 'path' string is required");
  const abs = path.resolve(root, rel);
  const within = path.relative(path.resolve(root), abs);
  if (within !== "" && (within.startsWith("..") || path.isAbsolute(within))) {
    throw new Error(`path escapes the workspace: ${rel}`);
  }
  return abs;
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(${text.length - max} more chars truncated)`;
}

/**
 * Collapse a large file listing to the deduped set of directory prefixes just below the
 * listed folder (trailing "/"), so an over-broad `list_files` returns a scoping map the
 * model can drill into instead of thousands of paths that blow its context. Files that
 * sit directly at the listed folder are kept as-is (so a root doc like `ROADMAP.md` is
 * still discoverable). Bounded to LIST_RETURN_MAX entries.
 */
function summarizeDirs(paths: string[], subdir?: string): string[] {
  const baseDepth = subdir ? subdir.split("/").filter(Boolean).length : 0;
  const depth = baseDepth + 2; // show up to two levels below the listed folder
  const dirs = new Set<string>();
  for (const p of paths) {
    const segs = p.split("/");
    if (segs.length <= 1) { dirs.add(p); continue; } // a file at the listed root
    const cut = Math.min(depth, segs.length - 1);
    dirs.add(`${segs.slice(0, cut).join("/")}/`);
  }
  return [...dirs].sort().slice(0, LIST_RETURN_MAX);
}

/**
 * Collect repo-relative file paths under `start`, bounded + ignoring noise.
 *
 * BREADTH-FIRST (a directory queue), not depth-first recursion: shallow files —
 * root docs like `ROADMAP.md` — are always collected before the `LIST_MAX_FILES`
 * budget is exhausted deep inside a huge early subtree (the bug that made a
 * root-level file invisible to `list_files`, so the agent wrongly concluded it did
 * not exist). Output is sorted for stable, scan-able results. Mirrors the on-prem
 * Node provider's walk so the two behave identically.
 */
async function walkFiles(start: string, root: string): Promise<{ paths: string[]; truncated: boolean }> {
  const out: string[] = [];
  const queue: string[] = [start];
  let truncated = false;
  while (queue.length > 0) {
    if (out.length >= LIST_MAX_FILES) { truncated = true; break; }
    const dir = queue.shift()!;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        queue.push(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        if (out.length >= LIST_MAX_FILES) { truncated = true; break; }
        out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/"));
      }
    }
  }
  return { paths: out.sort((a, b) => a.localeCompare(b)), truncated };
}

/** Build the editor's local-disk capability provider rooted at the open folder. */
export function buildLocalCapabilityProvider(root: string): CapabilityProvider {
  const rootResolved = path.resolve(root);

  const repoRead = {
    async listFiles(subdir?: string, glob?: string): Promise<RepoListResult> {
      const start = subdir ? resolveInRoot(rootResolved, subdir) : rootResolved;
      const { paths, truncated } = await walkFiles(start, rootResolved);
      // A glob is an explicit "find these files" — return the full matches (never the
      // directory summary), so a named file is always surfaced even in a big repo.
      if (glob) {
        return { ok: true, paths: filterByGlob(paths, glob), truncated };
      }
      // Too many to hand back verbatim — return the child directories to scope into
      // (with trailing "/") instead of flooding the model with every path. Root files
      // are kept in the summary, so a top-level doc stays discoverable.
      if (paths.length > LIST_RETURN_MAX) {
        return { ok: true, paths: summarizeDirs(paths, subdir), truncated: true };
      }
      return { ok: true, paths, truncated };
    },
    async readFile(p: string): Promise<RepoReadResult> {
      const abs = resolveInRoot(rootResolved, p);
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) return { ok: false, path: p, error: "file not found" };
      if (stat.isDirectory()) return { ok: false, path: p, error: "path is a directory, not a file — use list_files to see its contents" };
      if (stat.size <= MAX_READ_BYTES) {
        return { ok: true, path: p, content: await fs.readFile(abs, "utf-8") };
      }
      // Oversized: hand back a bounded prefix marked truncated instead of failing, so the
      // model still gets the start of the file and the read_file tool paginates from there.
      const handle = await fs.open(abs, "r");
      try {
        const buf = Buffer.alloc(MAX_READ_BYTES);
        const { bytesRead } = await handle.read(buf, 0, MAX_READ_BYTES, 0);
        return { ok: true, path: p, content: buf.subarray(0, bytesRead).toString("utf-8"), truncated: true };
      } finally {
        await handle.close();
      }
    },
    async searchCode(query: string, scope?: string): Promise<RepoSearchResult> {
      let re: RegExp;
      try {
        re = new RegExp(query, "i");
      } catch (e) {
        return { ok: false, query, error: `invalid regex: ${e instanceof Error ? e.message : String(e)}` };
      }
      // Optional subdirectory scope: on a big monorepo an unscoped walk can hit the
      // file cap before it reaches the relevant subtree, so the model can narrow here.
      let start = rootResolved;
      if (scope && scope.trim()) {
        try {
          start = resolveInRoot(rootResolved, scope.trim());
        } catch (e) {
          return { ok: false, query, error: e instanceof Error ? e.message : String(e) };
        }
      }
      const matches: Array<{ path: string; line: number; text: string }> = [];
      let filesScanned = 0;
      let truncated = false;
      // BREADTH-FIRST (a directory queue), NOT depth-first recursion — the same fix
      // `walkFiles` (list_files) already carries. Depth-first plunged into the first
      // large subtree and exhausted SEARCH_MAX_FILES before reaching later packages,
      // so a symbol that lived deeper (e.g. under packages/) came back `total:0,
      // truncated:true` — a false "not found" that sent the agent into read_file
      // spirals. BFS scans shallow files across the whole tree first, so the cap (if
      // hit at all) truncates evenly instead of skipping entire subtrees.
      const queue: string[] = [start];
      while (queue.length > 0) {
        if (matches.length >= SEARCH_MAX_MATCHES || filesScanned >= SEARCH_MAX_FILES) { truncated = true; break; }
        const dir = queue.shift()!;
        let entries: import("fs").Dirent[];
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          if (matches.length >= SEARCH_MAX_MATCHES || filesScanned >= SEARCH_MAX_FILES) { truncated = true; break; }
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
            queue.push(abs);
          } else if (entry.isFile()) {
            const stat = await fs.stat(abs).catch(() => null);
            if (!stat || stat.size > SEARCH_MAX_FILE_BYTES) continue;
            filesScanned++;
            const content = await fs.readFile(abs, "utf-8").catch(() => "");
            if (content.includes("\0")) continue; // binary — skip
            const rel = path.relative(rootResolved, abs).split(path.sep).join("/");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i])) {
                matches.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, 200) });
                if (matches.length >= SEARCH_MAX_MATCHES) { truncated = true; break; }
              }
            }
          }
        }
      }
      return { ok: true, query, total: matches.length, truncated, matches };
    },
  };

  const repoWrite = {
    async writeFile(p: string, content: string): Promise<RepoWriteResult> {
      const abs = resolveInRoot(rootResolved, p);
      const existed = await fs.stat(abs).then(() => true, () => false);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf-8");
      return { ok: true, change: existed ? "modified" : "created" };
    },
    async deleteFile(p: string): Promise<RepoDeleteResult> {
      const abs = resolveInRoot(rootResolved, p);
      try {
        await fs.rm(abs);
        return { ok: true, deleted: true };
      } catch {
        return { ok: false, deleted: false, code: "not_found", error: "file not found" };
      }
    },
    async editFile(p: string, oldString: string, newString: string, replaceAll?: boolean): Promise<RepoEditResult> {
      const abs = resolveInRoot(rootResolved, p);
      const current = await fs.readFile(abs, "utf-8");
      const first = current.indexOf(oldString);
      if (first === -1) return { ok: false, error: "oldString not found in file" };
      if (!replaceAll && current.indexOf(oldString, first + oldString.length) !== -1) {
        return { ok: false, error: "oldString is not unique; add more context or set replaceAll" };
      }
      const next = replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, newString);
      const replaced = replaceAll ? current.split(oldString).length - 1 : 1;
      await fs.writeFile(abs, next, "utf-8");
      return { ok: true, change: "modified", replaced };
    },
  };

  const shell = {
    async run(command: string): Promise<ShellResult> {
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: rootResolved,
          timeout: RUN_TIMEOUT_MS,
          maxBuffer: RUN_MAX_BUFFER,
          windowsHide: true,
        });
        const out = [stdout, stderr].filter((s) => s && s.trim()).join("\n").trim();
        return { ok: true, exitCode: 0, stdout: clamp(out || "(no output)", RUN_MAX_OUTPUT) };
      } catch (e) {
        const err = e as { code?: number | string; killed?: boolean; signal?: string; stdout?: string; stderr?: string; message?: string };
        const out = [err.stdout, err.stderr].filter((s) => s && String(s).trim()).join("\n").trim();
        if (err.killed || err.signal === "SIGTERM") {
          return { ok: false, error: `timed out after ${RUN_TIMEOUT_MS / 1000}s`, stdout: clamp(out, RUN_MAX_OUTPUT) };
        }
        const code = typeof err.code === "number" ? err.code : 1;
        return { ok: false, exitCode: code, stdout: clamp(out || err.message || "(no output)", RUN_MAX_OUTPUT) };
      }
    },
  };

  return { capabilities: LOCAL_SURFACE_CAPS, repoRead, repoWrite, shell };
}
