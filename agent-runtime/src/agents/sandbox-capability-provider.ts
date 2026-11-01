/**
 * `buildSandboxCapabilityProvider` — the sandbox-aware concretion of the shared
 * `@builderforce/agent-tools` {@link CapabilityProvider}, the fs-bridge twin of the
 * on-prem disk {@link buildNodeCapabilityProvider}. It lets the SAME shared
 * `ToolDefinition`s (`write_file`/`edit_file`/`delete_file`/`list_files`) run inside a
 * SANDBOXED session, where file ops are routed through the {@link SandboxFsBridge} into
 * the container rather than direct `node:fs`.
 *
 * This is the "documented follow-up" named in `node-capability-provider.ts`: until now
 * the converged on-prem file tools were gated to NON-sandboxed sessions (`&& !sandboxRoot`
 * in `coding-tools.ts`), because the disk provider cannot reach the container. This
 * provider closes that gap, so a sandboxed session converges onto the same shared
 * definitions a non-sandboxed one runs — one definition per tool across BOTH session
 * kinds (PRD 12 Phase B, completed).
 *
 * Capability surface: `repo.read` (list/read), `repo.write`, `repo.edit`, `repo.delete`.
 * `repo.search`/`repo.symbols` are NOT advertised — there is no indexed searcher inside
 * the container; grepping is the native `exec` tool's job (which stays native).
 * `shell`/`process`/`web`/`human`/etc. stay on their native tools this pass, exactly as
 * the non-sandboxed converged set already does.
 *
 * Backing split: per-file read/write/edit/delete go through the bridge (the container
 * view, mount-aware and traversal-confined). `list_files` walks the sandbox workspace's
 * HOST mount via `node:fs` — the same tree the bridge reads, and the same pattern the
 * native sandboxed tools and the test host-bridge already rely on (the bridge exposes
 * stat/path ops, not readdir). Path confinement for per-file ops resolves through
 * {@link resolveInsideRoot}-equivalent logic, so the provider is self-guarding — the
 * same property the disk provider gets from `resolveInsideRoot`.
 *
 * `read`/`exec`/`process` are NOT routed through this provider (the ticket's explicit
 * constraint): `read` stays on the native sandboxed read tool (image + budget features
 * the text-only shared `read_file` cannot express), and `exec`/`process` stay on the
 * native shell tools.
 */

import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  applyStringEdit,
  dirMayContainGlobMatch,
  editFacts,
  matchGlobInScope,
} from "@builderforce/agent-tools";
import type {
  Capability,
  CapabilityProvider,
  RepoDeleteResult,
  RepoEditResult,
  RepoListResult,
  RepoReadResult,
  RepoWriteResult,
} from "@builderforce/agent-tools";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";

/** Directories never walked by `list_files` — the SAME ignore set the on-prem disk
 *  provider uses, mirrored here so the two surfaces agree on what a walk skips. */
const LIST_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
]);

const LIST_MAX_FILES = 5_000;

/** The capability set the sandbox provider advertises: read/write/edit/delete, WITHOUT
 *  `repo.search`/`repo.symbols` (no indexed searcher inside the container) and WITHOUT
 *  `human` (kept off this pass, as in the original converged set). */
export const SANDBOX_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  "repo.read",
  "repo.write",
  "repo.edit",
  "repo.delete",
]);

/** Per-file read/write/edit/delete confinement, mirroring the disk provider's
 *  `NodeWriteScope`: `"workspace"` confines every path inside the root (secure default);
 *  `"unconfined"` permits absolute/`..` paths outside it, matching the native sandboxed
 *  tools with `tools.fs.workspaceOnly` unset — so convergence swaps the implementation
 *  and never the security boundary. */
export type SandboxWriteScope = "workspace" | "unconfined";

export interface SandboxProviderOptions {
  /** Absolute host path of the sandbox workspace root (the container's host mount).
   *  `list_files` walks this host mount; per-file ops resolve inside it (confinement). */
  workspaceRoot: string;
  /** The session's fs-bridge — the container view used for every file read/write. */
  bridge: SandboxFsBridge;
  /** Per-file op confinement; defaults to `"workspace"` (secure by default). */
  scope?: SandboxWriteScope;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function resolveInsideRoot(root: string, p: string): string | null {
  const target = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(resolve(root), target);
  if (rel === "") {
    return target;
  }
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  return target;
}

async function walkFiles(
  root: string,
  scope: string,
  glob: string | undefined,
  scopeArg: string | undefined,
): Promise<{ paths: string[]; truncated: boolean }> {
  const out: string[] = [];
  const queue: string[] = [scope];
  let truncated = false;
  while (queue.length > 0) {
    if (out.length >= LIST_MAX_FILES) {
      truncated = true;
      break;
    }
    const dir = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (LIST_IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        const childRel = toPosix(relative(root, full));
        if (glob && !dirMayContainGlobMatch(childRel, glob, scopeArg)) {
          continue;
        }
        queue.push(full);
      } else if (entry.isFile()) {
        const rel = toPosix(relative(root, full));
        if (glob && !matchGlobInScope(rel, glob, scopeArg)) {
          continue;
        }
        if (out.length >= LIST_MAX_FILES) {
          truncated = true;
          break;
        }
        out.push(rel);
      }
    }
  }
  return { paths: out.toSorted(), truncated };
}

/**
 * Build the sandbox-aware {@link CapabilityProvider}. Per-file read/write/edit/delete
 * are backed by the {@link SandboxFsBridge} (container view, traversal-confined); the
 * capability set is exactly {@link SANDBOX_SURFACE_CAPS}.
 */
export function buildSandboxCapabilityProvider(
  options: SandboxProviderOptions,
): CapabilityProvider {
  const root = resolve(options.workspaceRoot);
  const escaped = (path: string) => `'${path}' is outside the workspace`;
  const resolveFile =
    (options.scope ?? "workspace") === "workspace"
      ? (p: string) => resolveInsideRoot(root, p)
      : (p: string) => (isAbsolute(p) ? resolve(p) : resolve(root, p));
  const bridge = options.bridge;

  return {
    capabilities: SANDBOX_SURFACE_CAPS,
    repoRead: {
      async listFiles(sub, glob): Promise<RepoListResult> {
        const scope = sub ? resolveInsideRoot(root, sub) : root;
        if (!scope) {
          return { ok: false, error: escaped(sub ?? "") };
        }
        const { paths, truncated } = await walkFiles(root, scope, glob, sub);
        return { ok: true, paths, truncated };
      },
      async readFile(path): Promise<RepoReadResult> {
        const abs = resolveFile(path);
        if (!abs) {
          return { ok: false, error: escaped(path) };
        }
        try {
          const buf = await bridge.readFile({ filePath: abs, cwd: root });
          return { ok: true, path, content: buf.toString("utf-8") };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Normalize to the shared phrasing the disk provider uses, so a prompt that
          // recovers from `file not found` on one surface recovers on the other.
          if (msg.includes("No such file") || msg.includes("ENOENT")) {
            return { ok: false, error: `file not found: ${path}` };
          }
          if (
            msg.includes("Is a directory") ||
            msg.includes("EISDIR") ||
            msg.includes("illegal operation on a directory")
          ) {
            return {
              ok: false,
              error: `'${path}' is a directory, not a file — use list_files to see its contents`,
            };
          }
          return { ok: false, error: msg };
        }
      },
      // `repo.search` is not advertised, so the registry never routes `search_code` here.
      async searchCode(): Promise<never> {
        throw new Error("sandbox provider does not back repo.search");
      },
    },
    repoWrite: {
      async writeFile(path, content): Promise<RepoWriteResult> {
        const abs = resolveFile(path);
        if (!abs) {
          return { ok: false, error: escaped(path) };
        }
        const stat = await bridge.stat({ filePath: abs, cwd: root }).catch(() => null);
        const existed = !!stat;
        try {
          await bridge.writeFile({ filePath: abs, cwd: root, data: content });
          return { ok: true, change: existed ? "modified" : "created" };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      async editFile(path, oldString, newString, replaceAll): Promise<RepoEditResult> {
        const abs = resolveFile(path);
        if (!abs) {
          return { ok: false, error: escaped(path) };
        }
        let raw: string;
        try {
          const buf = await bridge.readFile({ filePath: abs, cwd: root });
          raw = buf.toString("utf-8");
        } catch {
          return { ok: false, error: `file not found: ${path}` };
        }
        // The SHARED edit core, not a local copy — parity with the disk provider.
        const result = applyStringEdit(raw, oldString, newString, replaceAll === true);
        if (!result.ok || result.content === undefined) {
          return { ok: false, ...editFacts(result), error: result.error ?? "edit failed" };
        }
        try {
          await bridge.writeFile({ filePath: abs, cwd: root, data: result.content });
          return { ok: true, change: "modified", ...editFacts(result) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      async deleteFile(path): Promise<RepoDeleteResult> {
        const abs = resolveFile(path);
        if (!abs) {
          return { ok: false, error: escaped(path) };
        }
        const stat = await bridge.stat({ filePath: abs, cwd: root }).catch(() => null);
        if (!stat) {
          // Not in the container — benign no-op so the model doesn't treat it as a failure.
          return {
            ok: true,
            deleted: false,
            note: `'${path}' does not exist, so there is nothing to delete.`,
          };
        }
        try {
          await bridge.remove({ filePath: abs, cwd: root });
          return { ok: true, deleted: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
  };
}
