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

import * as path from "path";
import { hostCostLeverOn } from "../host/hostCostLevers";
import { DELEGATION_CAPABILITIES } from "@builderforce/agent-tools";
// The ONE coding provider (list/read/search/write/edit/delete) over the ONE local-disk adapter
// (workspace containment, ripgrep-first search, byte caps) - shared with the on-prem provider and the
// workspace MCP. The adapter is Node-only, so it comes from its own export condition (the package
// root stays node-builtin-free for the Worker).
import { createRepoCapabilities } from "@builderforce/agent-tools/workspace";
import { nodeWorkspaceFs } from "@builderforce/agent-tools/node-workspace";
import type { Capability, CapabilityProvider } from "@builderforce/agent-tools";

import type { LocalResearchCapability, RepoSemanticCapability, RepoSymbolsCapability } from "@builderforce/agent-tools";
import { desktopSemanticCapability } from "../context/desktopContext";
import { createLocalShell } from "./localShell";
import { workspaceSymbolIndex } from "../workspace/workspaceSymbols";

/** The capabilities the editor surface can physically back: read/search/write/edit/
 *  delete the open folder, plus a real shell (so `run_command` + the `git_*` tools
 *  are offered, identical to the cloud Container). */
export const LOCAL_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  "repo.read", "repo.search", "repo.write", "repo.edit", "repo.delete", "shell",
  // Background shell jobs (`run_command` background / yieldMs → `command_status` /
  // `command_stop`), backed by `localShell.ts`'s job table.
  "shell.jobs",
  // Retained full command outputs (`localShellOutputs.ts`) behind `output_filter`: grep/head/tail
  // an earlier result instead of re-running it. Cloud sandboxes keep no outputs, so it is its own cap.
  "shell.outputs",
  // The definition index behind `find_symbol` / `file_outline` (see workspaceSymbols.ts):
  // "where is X defined" in one call, and a file's map before paging through it.
  "repo.symbols",
  // The semantic index behind `semantic_search` / `repo_map`, served by Builderforce
  // Desktop (see desktopContext.ts). Declared here so the tools are built; each run's
  // catalog then withholds them while the desktop service is not running.
  "repo.semantic",
  // `read_compressed` (the Desktop service's LLMLingua-2 compressor) and `local_research`
  // (a local model reads files and answers). Declared so the tools are built; the run's
  // catalog withholds each while its backing is absent (`brainToolCatalog.ts`).
  "repo.compress",
  "local.research",
  // Publishing (commit / push / open a pull request). Backed HERE and on no cloud
  // surface: those already publish by a different mechanism (a write IS a commit, and
  // the engine opens the PR at finish), whereas the editor could change a working tree
  // and had no verb for shipping it — so "commit and push" fell through to a raw
  // `run_command` shelling `git add -A && git push` at the base branch. Runs on the
  // same `shell` this provider already backs; the capability is separate because what
  // a surface may push to a remote is a different question from whether it has a shell.
  "git.write",
]);

/**
 * What a run that can DELEGATE holds on the editor: the surface's own, plus the editor's children
 * running live (`subagentControlTools.ts` backs wait/message/stop) and fanning out. The capability set
 * the spawn tools are described under - not `LOCAL_SURFACE_CAPS` alone, which has no delegation. The
 * delegation capabilities are the shared list (`DELEGATION_CAPABILITIES`), so the fan-out tool's own
 * requirement is held too and there is no second statement of them.
 *
 * KEEP IN STEP: when the editor moves onto the ONE agent (`runAgent`, PRD 35 WS4) this set must BE the
 * capability provider's `capabilities`, not a second statement of them - the description a model reads
 * and the tools it is actually granted must not be able to drift apart.
 */
export const EDITOR_DELEGATION_CAPS: ReadonlySet<Capability> = new Set<Capability>([...LOCAL_SURFACE_CAPS, ...DELEGATION_CAPABILITIES]);

/** What the host can lend the provider beyond the folder itself. */
export interface LocalProviderOptions {
  /**
   * Resolve the ripgrep binary `search_code` should run (see `ripgrep.ts`), or null to
   * walk the tree in-process. Injected rather than imported so the provider stays a
   * pure Node module and a test can pin either backend.
   */
  ripgrep?: () => Promise<string | null>;
  /** The definition index. Defaults to the workspace's shared one; a test can pin its own. */
  symbols?: RepoSymbolsCapability & { markDirty(path: string): void };
  /** The semantic index — the catalog-time resolution (`localSemantic.ts`: Desktop when
   *  it answers, with its compressor; else `repo_map` from the symbol index). Defaults to
   *  Desktop's without the compressor; a test can pin its own. */
  semantic?: RepoSemanticCapability;
  /** The local model `local_research` asks (`localResearch/`). Absent ⇒ that tool refuses. */
  research?: LocalResearchCapability;
  /** The call's Stop — kills a running ripgrep and ends the fallback walk. */
  signal?: AbortSignal;
  /** The run's default checkout (`resolveDefaultRepo`), handed to the shell. */
  defaultRepo?: string;
  /** The run this provider's background jobs belong to (its run key) — scoped ids, and
   *  killed when that run settles (`localShellJobs.ts`). */
  jobOwner?: number;
}

/** Build the editor's local-disk capability provider rooted at the open folder. */
export function buildLocalCapabilityProvider(root: string, options: LocalProviderOptions = {}): CapabilityProvider {
  const rootResolved = path.resolve(root);
  const symbols = options.symbols ?? workspaceSymbolIndex(rootResolved);

  // The ONE provider over the ONE adapter; a write marks the symbol index dirty. The run's Stop
  // and the lazily resolved ripgrep ride the adapter (a search's own stop is merged per call).
  const { repoRead, repoWrite } = createRepoCapabilities(
    nodeWorkspaceFs(rootResolved, { ripgrep: options.ripgrep ?? null, ...(options.signal ? { signal: options.signal } : {}) }),
    { onWrite: (rel) => symbols.markDirty(path.resolve(rootResolved, rel)) },
  );

  // The ONE local shell runner (`localShell.ts`) — shared with the workspace hooks.
  // The run's default checkout rides on it, so git and `run_command` start there.
  const shell = { ...createLocalShell(rootResolved, { jobOwner: options.jobOwner }), ...(options.defaultRepo ? { defaultRepo: options.defaultRepo } : {}) };

  const semantic = options.semantic ?? desktopSemanticCapability(rootResolved, { adaptive: hostCostLeverOn("c4_adaptive_context") });
  return { capabilities: LOCAL_SURFACE_CAPS, repoRead, repoWrite, symbols, semantic, shell, ...(options.research ? { research: options.research } : {}) };
}
