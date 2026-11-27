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
 * cloud searcher hits a git-index, this runs the shared exact/regex searcher
 * (`agent-tools/node-text-search`, the same one the editor uses). Every
 * path is resolved INSIDE `workspaceRoot` and a traversal escape is rejected, so the
 * provider is self-guarding (no external `workspaceOnly` wrapper needed).
 *
 * Sandbox note: a sandboxed session routes file ops through an fs-bridge into the
 * container, NOT `node:fs`. This provider writes directly to disk, so the converged
 * path is gated to NON-sandboxed sessions by its caller; a sandbox-aware provider
 * (fs-bridge backed) is the documented follow-up.
 */

import { resolve as resolvePath } from "node:path";
import { semanticCapabilitiesOf } from "@builderforce/agent-tools";
// The ONE coding provider (list/read/search/write/edit/delete) over the ONE local-disk adapter,
// shared with the VS Code provider and the workspace MCP. The adapter is Node-only, so it comes
// from its own export condition (the package root stays node-builtin-free for the Worker).
import { createRepoCapabilities } from "@builderforce/agent-tools/workspace";
import { nodeWorkspaceFs } from "@builderforce/agent-tools/node-workspace";
// The ONE definition index (shared with the VS Code workspace) behind `find_symbol` /
// `file_outline`, in its one on-prem configuration (tree-sitter, persisted snapshot).
import { onPremSymbolIndex } from "./on-prem-symbol-index.js";
import type {
  Capability,
  CapabilityProvider,
  HumanAskResult,
  LocalResearchCapability,
  RepoSemanticCapability,
} from "@builderforce/agent-tools";
import { onDeviceCostLeverOn } from "../infra/cost-levers.js";
import { resolveOnPremSemantic } from "./on-prem-semantic.js";
import { execFile } from "node:child_process";
import { requestHumanInput, type HumanInputRequest, type HumanInputResult } from "../infra/approval-gate.js";

/** `rg` when it is runnable from PATH, else null (the shared searcher then walks the tree
 *  in-process). Probed once per process: a missing binary is the common on-prem case. */
let onPathRipgrep: Promise<string | null> | undefined;
function findOnPathRipgrep(): Promise<string | null> {
  onPathRipgrep ??= new Promise((resolve) => {
    execFile("rg", ["--version"], { windowsHide: true, timeout: 5_000 }, (err) => resolve(err ? null : "rg"));
  });
  return onPathRipgrep;
}

/** The file-only capability set an on-prem disk surface backs (repo read/search/write/
 *  edit/delete). Kept as its own export for callers that want JUST the file tools. */
export const NODE_FILE_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  "repo.read",
  "repo.search",
  "repo.symbols",
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

/**
 * How far a PATH-ADDRESSED file op (read/write/edit/delete of one named file) may reach.
 *
 * `list`/`search` are always confined to the root — they are additive on-prem (the
 * native loop has no converged equivalent), so confining them changes nothing. Writes are
 * different: the converged `write`/`edit` REPLACE native tools whose confinement is
 * governed by `tools.fs.workspaceOnly`, so the provider has to be able to express BOTH
 * settings — otherwise turning convergence on would silently re-scope every write, which
 * is a security-boundary move disguised as an implementation swap.
 *
 * `readFile` follows the SAME scope because shared `write_file` probes the target through
 * it before writing (the overwrite guard). A probe confined tighter than the write sees an
 * out-of-tree target as "outside the workspace" — not "not found" — and the guard refuses
 * every legitimate unconfined write. The native `read` is likewise confined only under
 * `tools.fs.workspaceOnly`, so this is parity, not a widening.
 */
export type NodeWriteScope =
  /** Every write path must resolve inside the workspace root. */
  | "workspace"
  /** Absolute (or `..`) paths outside the root are permitted; the root is still the base
   *  for relative paths. Mirrors the native tools with `tools.fs.workspaceOnly` unset. */
  | "unconfined";

export interface NodeProviderOptions {
  /** Absolute working-tree root; list/search are scoped inside it, per-file ops per {@link scope}. */
  workspaceRoot: string;
  /**
   * Confinement for per-file read/write/edit/delete. Defaults to `"workspace"` — secure by default for
   * any caller that does not think about it. The converged on-prem tool set passes the
   * agent's own `tools.fs.workspaceOnly` here, so enabling convergence swaps the
   * IMPLEMENTATION without moving the boundary. See {@link NodeWriteScope}.
   */
  scope?: NodeWriteScope;
  /** Override for the human-in-the-loop backend (DI seam for tests). Defaults to the
   *  process-wide {@link requestHumanInput} approval gate, which blocks until a human
   *  answers in the Builderforce portal (or auto-answers in standalone mode). */
  requestHuman?: (req: HumanInputRequest) => Promise<HumanInputResult>;
  /**
   * `repo.semantic` (repo map, plus search with Desktop). Catalog-time only:
   * {@link catalogNodeCapabilityProvider} resolves it (`on-prem-semantic.ts`) —
   * Desktop when the service answers, else the definition index serving `repo_map`.
   * The sync builder never always-on advertises the cap: omitted, no semantic tool.
   */
  semantic?: RepoSemanticCapability;
  /**
   * `local.research` (`local_research`): a model on this machine reads files and answers.
   * Catalog-time only (`local-research/on-prem-research-model.ts`), set while a local
   * model answers. Omitted ⇒ the tool is not advertised.
   */
  research?: LocalResearchCapability;
}

/**
 * Build the on-prem disk-backed {@link CapabilityProvider}. List/search the working tree
 * (always confined to {@link NodeProviderOptions.workspaceRoot}), read/write/edit/delete
 * files in place (confined per {@link NodeProviderOptions.scope}), and escalate to a
 * human via the shared `human` capability.
 */
export function buildNodeCapabilityProvider(options: NodeProviderOptions): CapabilityProvider {
  const root = resolvePath(options.workspaceRoot);
  const askHuman = options.requestHuman ?? requestHumanInput;
  const scope = options.scope ?? "workspace";
  // The ONE provider over the ONE adapter. Per-file read/write/edit/delete follow `scope` (one
  // scope, so the write guard's probe sees the same file the write lands on); list/search are
  // always confined to the root. A write marks the symbol index dirty.
  const { repoRead, repoWrite } = createRepoCapabilities(nodeWorkspaceFs(root, { scope, ripgrep: findOnPathRipgrep }), {
    unconfined: scope === "unconfined",
    onWrite: (rel) => symbols.markDirty(resolvePath(root, rel)),
  });
  // Process-wide per root: a provider is built per session, and an index per provider
  // would re-walk the tree every time. Persisted beside the on-prem search index.
  const symbols = onPremSymbolIndex(root);

  // `repo.compress` (read_compressed) rides the semantic backing only while it has a compressor.
  const capabilities: ReadonlySet<Capability> =
    options.semantic || options.research
      ? new Set<Capability>([
          ...NODE_SURFACE_CAPS,
          ...semanticCapabilitiesOf(options.semantic),
          ...(options.research ? (["local.research"] as const) : []),
        ])
      : NODE_SURFACE_CAPS;

  return {
    capabilities,
    ...(options.semantic ? { semantic: options.semantic } : {}),
    ...(options.research ? { research: options.research } : {}),
    symbols,
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
    repoRead,
    repoWrite,
  };
}

/**
 * Catalog-time builder: resolves `repo.semantic` (`on-prem-semantic.ts`) — Builderforce
 * Desktop when its health probe succeeds, else the definition index serving `repo_map`.
 * The sync {@link buildNodeCapabilityProvider} stays always-off for that cap so callers
 * that skip the catalog resolve cannot leak a semantic tool into a run with no backing.
 */
export async function catalogNodeCapabilityProvider(
  options: NodeProviderOptions,
): Promise<CapabilityProvider> {
  const semantic = options.semantic ?? (await resolveOnPremSemantic(options.workspaceRoot, {
      // C4 for an on-device host (bucketed by the install id).
      adaptive: onDeviceCostLeverOn("c4_adaptive_context"),
    }));
  return buildNodeCapabilityProvider({ ...options, semantic });
}
