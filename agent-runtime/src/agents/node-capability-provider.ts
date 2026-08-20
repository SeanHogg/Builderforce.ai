/**
 * `buildNodeCapabilityProvider` — the on-prem (Node) concretion of the shared
 * `@builderforce/agent-tools` {@link CapabilityProvider}, the disk+shell twin of the
 * cloud `buildCloudProvider` (api `cloudAgentEngine.ts`). It lets the SAME shared
 * `ToolDefinition`s (`write_file`/`edit_file`/`delete_file`/`list_files`/`search_code`)
 * run on-prem against the checked-out working tree, instead of a second native copy of
 * each tool object — closing the "tools run on prem AND cloud, one definition" goal
 * (PRD 12 Phase B) for the file subset.
 *
 * Where the cloud provider commits over the git API, this one writes to disk; where the
 * cloud searcher hits a git-index, this shells out through the shared `runCodebaseSearch`
 * backend (the same one the native `codebase_search` tool already uses — DRY). Every
 * path is resolved INSIDE `workspaceRoot` and a traversal escape is rejected, so the
 * provider is self-guarding (no external `workspaceOnly` wrapper needed).
 *
 * Sandbox note: a sandboxed session routes file ops through an fs-bridge into the
 * container, NOT `node:fs`. This provider writes directly to disk, so the converged
 * path is gated to NON-sandboxed sessions by its caller; a sandbox-aware provider
 * (fs-bridge backed) is the documented follow-up.
 */

import { constants } from "node:fs";
import {
  access as fsAccess,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  readdir as fsReaddir,
  rm as fsRm,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { join, relative, resolve as resolvePath, sep } from "node:path";
import { applyStringEdit, filterByGlob, normalizeScopeDir, isUnderScopeDir } from "@builderforce/agent-tools";
// The ONE workspace-containment resolver, shared with the VS Code local provider.
// Node-only, so it comes from the `/node-path` export condition (the package root stays
// node-builtin-free for the Worker).
import { resolveInsideRoot as resolveInside } from "@builderforce/agent-tools/node-path.js";
import type {
  Capability,
  CapabilityProvider,
  HumanAskResult,
  RepoDeleteResult,
  RepoEditResult,
  RepoListResult,
  RepoReadResult,
  RepoSearchResult,
  RepoWriteResult,
} from "@builderforce/agent-tools";
import { IGNORED_DIRS, runCodebaseSearch } from "../builderforce/shared-tools/node-code-tools.js";
import { requestHumanInput, type HumanInputRequest, type HumanInputResult } from "../infra/approval-gate.js";

/** Directories never walked by `list_files` — the SAME ignore set the on-prem searcher
 *  uses (DRY: one source in node-code-tools), as a Set for O(1) membership. */
const LIST_IGNORED_DIRS = new Set(IGNORED_DIRS);
const LIST_MAX_FILES = 5_000;

/** The file-only capability set an on-prem disk surface backs (repo read/search/write/
 *  edit/delete). Kept as its own export for callers that want JUST the file tools. */
export const NODE_FILE_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  "repo.read",
  "repo.search",
  "repo.write",
  "repo.edit",
  "repo.delete",
]);

/** The full on-prem disk surface: the file caps PLUS `human` (the shared `ask_human`
 *  tool's requirement), so an on-prem coding agent can pause for a human through the
 *  SAME shared `ToolDefinition` the cloud loop runs — closing on-prem human-in-the-loop
 *  parity. `shell`/`process`/`web` still stay on the native tools this pass. */
export const NODE_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  ...NODE_FILE_SURFACE_CAPS,
  "human",
]);

async function walkFiles(
  root: string,
  scope: string,
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
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsReaddir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (LIST_IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        queue.push(join(dir, entry.name));
      } else if (entry.isFile()) {
        if (out.length >= LIST_MAX_FILES) {
          truncated = true;
          break;
        }
        out.push(relative(root, join(dir, entry.name)).split(sep).join("/"));
      }
    }
  }
  return { paths: out.toSorted(), truncated };
}

/**
 * How far a WRITE may reach.
 *
 * `read`/`list`/`search` are always confined to the root — they are additive on-prem (the
 * native loop has no converged equivalent), so confining them changes nothing. Writes are
 * different: the converged `write`/`edit` REPLACE native tools whose confinement is
 * governed by `tools.fs.workspaceOnly`, so the provider has to be able to express BOTH
 * settings — otherwise turning convergence on would silently re-scope every write, which
 * is a security-boundary move disguised as an implementation swap.
 */
export type NodeWriteScope =
  /** Every write path must resolve inside the workspace root. */
  | "workspace"
  /** Absolute (or `..`) paths outside the root are permitted; the root is still the base
   *  for relative paths. Mirrors the native tools with `tools.fs.workspaceOnly` unset. */
  | "unconfined";

export interface NodeProviderOptions {
  /** Absolute working-tree root; reads are scoped inside it, writes per {@link scope}. */
  workspaceRoot: string;
  /**
   * Confinement for WRITE operations. Defaults to `"workspace"` — secure by default for
   * any caller that does not think about it. The converged on-prem tool set passes the
   * agent's own `tools.fs.workspaceOnly` here, so enabling convergence swaps the
   * IMPLEMENTATION without moving the boundary. See {@link NodeWriteScope}.
   */
  scope?: NodeWriteScope;
  /** Override for the human-in-the-loop backend (DI seam for tests). Defaults to the
   *  process-wide {@link requestHumanInput} approval gate, which blocks until a human
   *  answers in the Builderforce portal (or auto-answers in standalone mode). */
  requestHuman?: (req: HumanInputRequest) => Promise<HumanInputResult>;
}

/**
 * Build the on-prem disk-backed {@link CapabilityProvider}. Read/list/search the working
 * tree (always confined to {@link NodeProviderOptions.workspaceRoot}), write/edit/delete
 * files in place (confined per {@link NodeProviderOptions.scope}), and escalate to a
 * human via the shared
 * `human` capability (so the on-prem coding agent can run the SAME shared `ask_human`
 * tool as the cloud loop).
 */
export function buildNodeCapabilityProvider(options: NodeProviderOptions): CapabilityProvider {
  const root = resolvePath(options.workspaceRoot);
  const escaped = (path: string) => `'${path}' is outside the workspace`;
  const askHuman = options.requestHuman ?? requestHumanInput;
  // Writes resolve through this; reads always use the confined `resolveInside`.
  const resolveForWrite =
    (options.scope ?? "workspace") === "workspace"
      ? (p: string) => resolveInside(root, p)
      : (p: string) => resolvePath(root, p);

  return {
    capabilities: NODE_SURFACE_CAPS,
    human: {
      async ask(question, context): Promise<HumanAskResult> {
        // On-prem the gate BLOCKS in-process until a human answers (or it auto-answers
        // in standalone mode), so the run never has to pause/resume — we return the
        // answer inline (`paused: false`). The shared `ask_human` tool maps this to a
        // direct answer for the model, identical contract to the cloud pause path.
        try {
          const r = await askHuman({
            kind: "question",
            actionType: "clarify.requirements",
            description: context ? `${question}\n\nContext: ${context}` : question,
          });
          if (r.decision === "timeout") {
            return {
              paused: false,
              answer: null,
              note: "No human responded in time. Do not assume an answer — retry, choose a safe default and say you did, or stop and explain you are blocked.",
            };
          }
          if (r.decision === "rejected") {
            return { paused: false, answer: null, note: "A human declined to answer. Adapt or stop." };
          }
          return {
            paused: false,
            answer: r.responseText ?? null,
            note: r.responseText
              ? "A human responded; use their answer to continue."
              : "No human is available (standalone mode); proceed using your best judgment.",
          };
        } catch (err) {
          return { paused: false, answer: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    repoRead: {
      async listFiles(sub, glob): Promise<RepoListResult> {
        const scope = sub ? resolveInside(root, sub) : root;
        if (!scope) {
          return { ok: false, error: escaped(sub ?? "") };
        }
        const { paths, truncated } = await walkFiles(root, scope);
        return { ok: true, paths: glob ? filterByGlob(paths, glob) : paths, truncated };
      },
      async readFile(path): Promise<RepoReadResult> {
        const abs = resolveInside(root, path);
        if (!abs) {
          return { ok: false, error: escaped(path) };
        }
        try {
          const content = await fsReadFile(abs, "utf-8");
          return { ok: true, path, content };
        } catch (err) {
          // A raw `ENOENT: … open 'C:\Users\…\workspace\x.ts'` did two bad things:
          // it leaked the host's ABSOLUTE path into the model's context (and every
          // transcript), and it worded "missing file" differently from every other
          // surface, so a prompt that recovers from `file not found` on the cloud did
          // not recover on-prem. Both are cross-provider divergences the parity test
          // caught. Normalize to the shared phrasing, keyed off the errno.
          if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
            return { ok: false, error: `file not found: ${path}` };
          }
          if ((err as NodeJS.ErrnoException | undefined)?.code === "EISDIR") {
            return { ok: false, error: `'${path}' is a directory, not a file — use list_files to see its contents` };
          }
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      async searchCode(query, scope): Promise<RepoSearchResult> {
        const r = (await runCodebaseSearch(root, { query })) as {
          error?: string;
          results?: Array<{ filePath: string } & Record<string, unknown>>;
        };
        if (r.error) {
          return { ok: false, error: r.error };
        }
        let matches = (r.results ?? []).map((m) => ({ path: m.filePath, ...m }));
        // Honor an optional subdirectory scope by prefix-filtering the ripgrep hits,
        // so `search_code`'s `path` argument narrows results here too (parity with the
        // editor provider that scopes its walk natively). Normalization + prefix-match
        // are the ONE shared helpers so this can't drift from the other providers. The
        // ripgrep result set is complete (not a capped ranked page), so filtering it is
        // lossless — unlike the cloud GitHub-API path, which must scope in the query.
        const scopeDir = normalizeScopeDir(scope);
        if (scopeDir) matches = matches.filter((m) => typeof m.path === "string" && isUnderScopeDir(m.path, scopeDir));
        return { ok: true, query, total: matches.length, matches };
      },
    },
    repoWrite: {
      async writeFile(path, content): Promise<RepoWriteResult> {
        const abs = resolveForWrite(path);
        if (!abs) {
          return { ok: false, error: escaped(path) };
        }
        let existed = true;
        try {
          await fsAccess(abs, constants.F_OK);
        } catch {
          existed = false;
        }
        try {
          await fsMkdir(resolvePath(abs, ".."), { recursive: true });
          await fsWriteFile(abs, content, "utf-8");
          return { ok: true, change: existed ? "modified" : "created" };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      async editFile(path, oldString, newString, replaceAll): Promise<RepoEditResult> {
        const abs = resolveForWrite(path);
        if (!abs) {
          return { ok: false, error: escaped(path) };
        }
        let raw: string;
        try {
          raw = await fsReadFile(abs, "utf-8");
        } catch {
          return { ok: false, error: `file not found: ${path}` };
        }
        // The SHARED edit core, not a local copy. The copy this replaced normalized the
        // WHOLE file to LF before writing, so a single surgical edit rewrote every line
        // ending in a CRLF working tree and produced a huge spurious diff — and its error
        // wording differed from the other two providers, so a prompt that recovers from a
        // failed edit on the cloud did not recover on-prem.
        const result = applyStringEdit(raw, oldString, newString, replaceAll === true);
        if (!result.ok || result.content === undefined) {
          return { ok: false, error: result.error ?? "edit failed" };
        }
        try {
          await fsWriteFile(abs, result.content, "utf-8");
          return { ok: true, change: "modified", replaced: result.replaced };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      async deleteFile(path): Promise<RepoDeleteResult> {
        const abs = resolveForWrite(path);
        if (!abs) {
          return { ok: false, error: escaped(path) };
        }
        try {
          await fsAccess(abs, constants.F_OK);
        } catch {
          // Not on disk — benign no-op so the model doesn't treat it as a failure.
          return {
            ok: true,
            deleted: false,
            note: `'${path}' does not exist, so there is nothing to delete.`,
          };
        }
        try {
          await fsRm(abs);
          return { ok: true, deleted: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
  };
}
