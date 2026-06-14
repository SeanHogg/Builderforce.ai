/**
 * The converged on-prem file tools — the production caller of `registryToAgentTools`
 * (PRD 12 Phase B acceptance). It offers the SAME shared `@builderforce/agent-tools`
 * `ToolDefinition`s the cloud loop runs — `write_file`/`edit_file`/`delete_file`/
 * `list_files` — to the native on-prem session loop, backed by a disk
 * {@link buildNodeCapabilityProvider} instead of a second native copy of each tool.
 *
 * `write_file`/`edit_file` are exposed under their NATIVE names (`write`/`edit`) so the
 * model-facing contract and the `tool-display.json` keys are unchanged — the DEFINITION
 * is the single shared one, only the backing differs by surface (Dependency Inversion).
 * `delete_file`/`list_files` are additive (the native base loop has no equivalent).
 *
 * `read`/`exec`/`process`/`search` stay NATIVE this pass: `read` returns images +
 * model-context-scaled budgets the text-only shared `read_file` cannot yet express, and
 * exec/process are shell/streaming (PRD 12 §5 Phase B prereqs). These converged tools
 * flow through the SAME `coding-tools.ts` normalize/hook/abort/policy pipeline as every
 * other native tool, so the hardening is preserved.
 */

import {
  deleteFileTool,
  editFileTool,
  listFilesTool,
  ToolRegistry,
  writeFileTool,
} from "@builderforce/agent-tools";
import { registryToAgentTools } from "../builderforce/agent-loop/tool-adapter.js";
import type { AnyAgentTool } from "./coding-tools.types.js";
import { buildNodeCapabilityProvider } from "./node-capability-provider.js";

/** Shared file-subset definitions converged on-prem this pass (read/exec/process/search
 *  stay native — see the module note). One source of truth: the cloud loop runs these
 *  exact objects. */
const CONVERGED_FILE_TOOLS = [writeFileTool, editFileTool, deleteFileTool, listFilesTool] as const;

/** The registry is workspace-INDEPENDENT (the tool defs are static), so it is built once
 *  at module load — only the disk provider is per-session (it closes over `workspaceRoot`). */
const CONVERGED_REGISTRY = new ToolRegistry(CONVERGED_FILE_TOOLS);

/** Shared name → model-facing name, so converged tools replace the native ones under the
 *  SAME name the loop/display already use. */
const NATIVE_NAME_ALIASES: Readonly<Record<string, string>> = {
  write_file: "write",
  edit_file: "edit",
};

/** Tool names the converged set OWNS on-prem — the native loop must drop its own copies of
 *  these so there is exactly one definition (no duplicate/shadowed tool). */
export const CONVERGED_TOOL_NAMES: ReadonlySet<string> = new Set(["write", "edit"]);

/**
 * Build the converged file tools for a non-sandboxed on-prem session, backed by a disk
 * capability provider scoped to `workspaceRoot`. Returns native `AgentTool`s ready to be
 * folded into the coding-tools pipeline.
 */
export function buildConvergedFileTools(params: { workspaceRoot: string }): AnyAgentTool[] {
  const provider = buildNodeCapabilityProvider({ workspaceRoot: params.workspaceRoot });
  return registryToAgentTools(CONVERGED_REGISTRY, provider, params.workspaceRoot, NATIVE_NAME_ALIASES);
}
