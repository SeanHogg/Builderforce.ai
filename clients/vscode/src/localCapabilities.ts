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
import { exec, execFile } from "child_process";
import { promisify } from "util";
import { filterByGlob, applyStringEdit, normalizeScopeDir } from "@builderforce/agent-tools";
// The ONE workspace-containment resolver, shared with the agent-runtime Node provider.
// Node-only, so it comes from the `/node-path` export condition (the package root stays
// node-builtin-free for the Worker).
import { resolveInsideRootOrThrow as resolveInRoot } from "@builderforce/agent-tools/node-path";
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

import { needsPosixShell, findBash, posixShellOption, cmdCannotRun } from "./posixShell";
import { SKIP_DIRS, searchWorkspace } from "./workspaceSearch";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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
// search_code lives in `workspaceSearch.ts` (ripgrep first, in-process walk as the
// fallback); the skip list is shared from there so listing and searching agree.

/** The capabilities the editor surface can physically back: read/search/write/edit/
 *  delete the open folder, plus a real shell (so `run_command` + the `git_*` tools
 *  are offered, identical to the cloud Container). */
export const LOCAL_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  "repo.read", "repo.search", "repo.write", "repo.edit", "repo.delete", "shell",
  // Publishing (commit / push / open a pull request). Backed HERE and on no cloud
  // surface: those already publish by a different mechanism (a write IS a commit, and
  // the engine opens the PR at finish), whereas the editor could change a working tree
  // and had no verb for shipping it — so "commit and push" fell through to a raw
  // `run_command` shelling `git add -A && git push` at the base branch. Runs on the
  // same `shell` this provider already backs; the capability is separate because what
  // a surface may push to a remote is a different question from whether it has a shell.
  "git.write",
]);

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

/** What the host can lend the provider beyond the folder itself. */
export interface LocalProviderOptions {
  /**
   * Resolve the ripgrep binary `search_code` should run (see `ripgrep.ts`), or null to
   * walk the tree in-process. Injected rather than imported so the provider stays a
   * pure Node module and a test can pin either backend.
   */
  ripgrep?: () => Promise<string | null>;
}

/** Build the editor's local-disk capability provider rooted at the open folder. */
export function buildLocalCapabilityProvider(root: string, options: LocalProviderOptions = {}): CapabilityProvider {
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
      // Optional scope: a subdirectory OR a single file inside the workspace. Resolved
      // here (the containment guard is the provider's job); the search itself — ripgrep
      // when the editor has one, the bounded walk otherwise — lives in workspaceSearch.
      let start = rootResolved;
      const scopeDir = normalizeScopeDir(scope);
      if (scopeDir) {
        try {
          start = resolveInRoot(rootResolved, scopeDir);
        } catch (e) {
          return { ok: false, query, error: e instanceof Error ? e.message : String(e) };
        }
      }
      const ripgrep = options.ripgrep ? await options.ripgrep().catch(() => null) : null;
      return searchWorkspace({ root: rootResolved, start, query, ripgrep });
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
      // EOL-tolerant, EOL-preserving match (shared with the cloud provider): an agent
      // that emits LF `oldString` against a CRLF file still matches, and the file's
      // existing line endings survive — the naive `indexOf` here used to fail every
      // surgical edit on a Windows/CRLF working tree ("it tried to change code and
      // couldn't").
      const edit = applyStringEdit(current, oldString, newString, replaceAll);
      if (!edit.ok || edit.content == null) return { ok: false, error: edit.error ?? "oldString not found in file" };
      await fs.writeFile(abs, edit.content, "utf-8");
      return { ok: true, change: "modified", replaced: edit.replaced };
    },
  };

  /** Execute once, in a named interpreter. `bash` null ⇒ the platform default shell. */
  async function execOnce(command: string, bash: string | null): Promise<ShellResult> {
    try {
      // A POSIX script goes to bash EXPLICITLY (`bash -c <script>`), not through the
      // platform shell with an override: the one thing that must not vary between
      // machines is which interpreter parses `set -e`. A one-liner keeps the default.
      const { stdout, stderr } = bash
        ? await execFileAsync(bash, ["-c", command], {
            cwd: rootResolved,
            timeout: RUN_TIMEOUT_MS,
            maxBuffer: RUN_MAX_BUFFER,
            windowsHide: true,
          })
        : await execAsync(command, {
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
  }

  const shell = {
    async run(command: string): Promise<ShellResult> {
      // A POSIX script with no POSIX shell to run it must say so. Letting it through
      // hands the script to `cmd.exe`, which parses `set -e` as its own builtin and
      // fails with "Environment variable -e not defined" — a message that names
      // neither the cause nor anything the agent could do about it.
      if (needsPosixShell(command) && !findBash()) {
        return {
          ok: false,
          error:
            "this command needs a POSIX shell (it uses set -e / $(…) / [ … ], or a unix utility such as head/grep/sed that cmd.exe does not have) "
            + "and no POSIX shell was found on this Windows machine. "
            + "Install Git for Windows (which ships bash), or re-run the work as plain single-line commands instead.",
        };
      }
      const bash = posixShellOption(command).shell ?? null;
      const first = await execOnce(command, bash);
      if (first.ok || bash) return first;
      // cmd.exe could not even ATTEMPT the command — an unlisted unix utility, a
      // single-quoted argument, a `$VAR`. `needsPosixShell` is a whitelist and will
      // always be incomplete, so the failure that reaches the agent must not be
      // `'head' is not recognized as an internal or external command`: retry once in
      // bash, which is what the command was written for. A genuine non-zero exit from
      // a program that DID run (a failing build) does not match, so nothing that
      // legitimately failed is run twice.
      const retryBash = findBash();
      if (!retryBash || !cmdCannotRun(first.stdout ?? "")) return first;
      return execOnce(command, retryBash);
    },
  };

  return { capabilities: LOCAL_SURFACE_CAPS, repoRead, repoWrite, shell };
}
