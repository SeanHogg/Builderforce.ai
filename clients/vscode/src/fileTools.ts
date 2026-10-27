/**
 * The editor's local tool set — now the SHARED `@builderforce/agent-tools` core tools
 * run against the open workspace, NOT a hand-rolled copy. The tool DEFINITIONS
 * (names, descriptions, JSON schemas) come verbatim from the registry the cloud
 * Worker/Container and on-prem Node engines use, so the VS Code Brain advertises the
 * EXACT same tools as the cloud Brain (one definition, one surface). This module only
 * adapts them to the extension's existing `ToolDef` shape and supplies the local-disk
 * capability provider that executes them — see {@link buildLocalCapabilityProvider}.
 */

import type { Capability } from "@builderforce/agent-tools";
import { buildCoreToolRegistry } from "@builderforce/agent-tools";
import { buildLocalCapabilityProvider, LOCAL_SURFACE_CAPS } from "./localCapabilities";
import { findRipgrep } from "./ripgrep";
import { hostCostLeverOn } from "./hostCostLevers";
import { resolveLocalSemantic } from "./localSemantic";
import { editorResearchCapability } from "./localResearch/researchCapability";

/**
 * One definition per tool: name, JSON-schema params, whether it mutates the
 * workspace, and the executor. The agent loop turns these into OpenAI tool specs
 * and dispatches results — so the tool contract lives in exactly one place (DRY).
 */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mutating: boolean;
  /**
   * Remote (platform) tools run server-side via the gateway MCP relay and need no
   * workspace root — they're available in chat-only mode too. Local file tools
   * leave this falsy and require a root. The agent loop branches on it.
   */
  remote?: boolean;
  execute: (args: Record<string, unknown>, root: string, run?: ToolRunOptions) => Promise<string>;
}

/** What the RUN lends one call, beyond the folder: its Stop and its default checkout. */
export interface ToolRunOptions {
  /** The call's cancel signal (the run's Stop, or a steer interrupting this step). */
  signal?: AbortSignal;
  /** The run's default checkout in a folder that CONTAINS checkouts (`resolveDefaultRepo`). */
  defaultRepo?: string;
  /** The run's key: its background jobs are its own, and die when it settles. */
  runKey?: number;
}

/** The one shared registry, built once. Adding a tool in `@builderforce/agent-tools`
 *  surfaces it here automatically (gated by {@link LOCAL_SURFACE_CAPS}). */
const registry = buildCoreToolRegistry();

/** Engine-control tools the conversational Brain loop doesn't interpret (it has no
 *  ticket-branch finish/PR step), so they're not offered in the editor. */
const EXCLUDED_TOOLS = new Set(["finish"]);

/** Tools that read but never change the workspace — so they skip the approval gate
 *  even though they ride a write/shell-capable surface. */
const READ_ONLY_TOOLS = new Set([
  "list_files", "read_file", "search_code", "find_symbol", "file_outline", "git_status", "git_diff", "git_history",
  "semantic_search", "repo_map", "read_compressed", "local_research",
]);

// `git.write` is here for the same reason `shell` is, and more so: committing, pushing
// and opening a pull request move work out of the working tree, and a push to the base
// branch leaves the machine entirely. The approval prompt is the ONLY thing standing
// between "the human asked me to push to main" and it happening.
const MUTATING_CAPS: ReadonlySet<Capability> = new Set<Capability>(["repo.write", "repo.edit", "repo.delete", "shell", "git.write"]);

function isMutating(name: string, requires: readonly Capability[]): boolean {
  if (READ_ONLY_TOOLS.has(name)) return false;
  return requires.some((c) => MUTATING_CAPS.has(c));
}

/**
 * Whether a call can reach `repo.semantic`: the tools that require it (`semantic_search`,
 * `repo_map`, `read_compressed`), and — with C8 on — the shell tools, whose output the
 * Desktop compressor shortens. Only those resolve the Desktop-or-index backing
 * (`resolveLocalSemantic`, a Desktop probe); every other call skips it.
 */
export function callUsesSemantic(requires: readonly Capability[], compressOutputs: boolean): boolean {
  return requires.some((c) => c === "repo.semantic" || c === "repo.compress" || (compressOutputs && c === "shell"));
}

/** Adapt the shared registry's tools (for the local surface) to the extension's
 *  `ToolDef` shape: same schema the cloud advertises, executed via the local provider. */
export const TOOL_DEFS: ToolDef[] = registry
  .toolsForCapabilities(LOCAL_SURFACE_CAPS)
  .filter((def) => !EXCLUDED_TOOLS.has(def.name))
  .map((def) => ({
    name: def.name,
    description: def.schema.function.description,
    parameters: def.schema.function.parameters as Record<string, unknown>,
    mutating: isMutating(def.name, def.requires),
    execute: async (args, root, run) => {
      const research = editorResearchCapability(root);
      const compressLargeOutputs = hostCostLeverOn("c8_token_compression");
      const semantic = callUsesSemantic(def.requires, compressLargeOutputs) ? await resolveLocalSemantic(root) : undefined;
      const result = await registry.dispatch(def.name, args, {
        // The ripgrep VS Code ships (or one on PATH) backs `search_code`, so a repo-wide
        // symbol search covers the whole workspace instead of the first 4,000 files.
        caps: buildLocalCapabilityProvider(root, {
          ripgrep: () => findRipgrep(),
          // Desktop with its compressor when it answers, else `repo_map` from the symbol
          // index — resolved only for a call that can use it (`callUsesSemantic`).
          ...(semantic ? { semantic } : {}),
          ...(research ? { research } : {}),
          ...(run?.signal ? { signal: run.signal } : {}),
          ...(run?.defaultRepo ? { defaultRepo: run.defaultRepo } : {}),
          ...(run?.runKey !== undefined ? { jobOwner: run.runKey } : {}),
        }),
        workspaceRoot: root,
        compressLargeOutputs,
        // Stop reaches the tool (and `run_command`'s process tree) through here.
        ...(run?.signal ? { signal: run.signal } : {}),
      });
      return JSON.stringify(result.data);
    },
  }));

/** Human-readable one-liner for an approval prompt / activity row. */
export function describeTool(name: string, args: Record<string, unknown>): string {
  const p = typeof args.path === "string" ? args.path : "";
  switch (name) {
    case "write_file":
      return `write ${p}`;
    case "edit_file":
      return `edit ${p}`;
    case "delete_file":
      return `delete ${p}`;
    case "read_file":
      return `read ${p}`;
    case "list_files":
      return `list ${p || "."}`;
    case "run_command":
      return `run: ${typeof args.command === "string" ? args.command.slice(0, 80) : ""}`;
    case "search_code":
      return `search ${typeof args.query === "string" ? `"${args.query.slice(0, 60)}"` : ""}`;
    case "find_symbol":
      return `find symbol ${typeof args.query === "string" ? `"${args.query.slice(0, 60)}"` : ""}`;
    case "file_outline":
      return `outline ${p}`;
    case "semantic_search":
      return `semantic search ${typeof args.query === "string" ? `"${args.query.slice(0, 60)}"` : ""}`;
    case "repo_map":
      return `repo map${Array.isArray(args.focus) && args.focus.length ? ` of ${args.focus.slice(0, 2).join(", ")}` : ""}`;
    case "read_compressed":
      return `read compressed ${p}`;
    case "local_research":
      return `ask local model ${typeof args.question === "string" ? `"${args.question.slice(0, 60)}"` : ""}`;
    case "review_ticket_branches":
      return `review ticket branches${typeof args.repo === "string" ? ` in ${args.repo}` : ""}`;
    // The project-memory pair (cognition.ts): named by what is being recalled/kept, so
    // an activity row reads "recall auth flow" rather than a bare tool name.
    case "recall_facts":
      return `recall ${typeof args.query === "string" ? `"${args.query.slice(0, 60)}"` : ""}`;
    case "remember_fact":
      return `remember ${typeof args.key === "string" ? args.key.slice(0, 60) : ""}`;
    // The publish actions name what LEAVES the machine. A prompt reading "git_push" tells
    // the approver nothing about the one thing they need to weigh — whether this is a
    // ticket branch or the base branch — so the base-branch case says so outright.
    case "git_commit": {
      const files = Array.isArray(args.paths) ? args.paths.filter((p): p is string => typeof p === "string") : [];
      const where = typeof args.branch === "string" && args.branch
        ? ` on ${args.branch}`
        : args.allowBaseBranch === true
          ? " on the BASE BRANCH (main) — skips pull-request review"
          : "";
      return `commit ${files.length} file${files.length === 1 ? "" : "s"}${where}: ${files.slice(0, 3).join(", ")}${files.length > 3 ? ", …" : ""}`;
    }
    case "git_push":
      return args.allowBaseBranch === true
        ? "push to the BASE BRANCH (main) — skips pull-request review"
        : "push the current branch to origin";
    // The one thing an approver needs to weigh here is WHICH branch is about to be
    // deleted, and whether the merge check is being skipped.
    case "git_cleanup_merged": {
      const branch = typeof args.branch === "string" && args.branch ? args.branch : "the current branch";
      return args.force === true
        ? `clean up ${branch} — FORCE-deletes it without git seeing the merge`
        : `clean up ${branch}: return to main and delete the merged branch`;
    }
    case "open_pull_request":
      return `open pull request: ${typeof args.title === "string" ? args.title.slice(0, 70) : ""}`;
    default:
      return name;
  }
}
