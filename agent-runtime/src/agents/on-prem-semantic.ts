/**
 * The on-prem `repo.semantic` backing, resolved the way the VS Code editor resolves it
 * (`clients/vscode/src/tools/localSemantic.ts`):
 *
 *   - Builderforce Desktop answering ⇒ its capability, with the compressor when its health
 *     probe reports one (`catalogDesktopSemantic`);
 *   - Desktop absent ⇒ the working tree's own code index and reference-ranked repo map
 *     (`workspaceSemantic`, the backing the Workspace MCP serves): `semantic_search` and
 *     `repo_map` both answer locally.
 *
 * The Desktop probe is cached for 30 s in node-desktop, so a per-run resolve costs nothing.
 */

import type { RepoSemanticCapability } from "@builderforce/agent-tools";
import { catalogDesktopSemantic, setDesktopClientName } from "@builderforce/agent-tools/node-desktop.js";
import { workspaceSemantic } from "@builderforce/workspace-mcp";
import { buildNodeCapabilityProvider } from "./node-capability-provider.js";
import { onPremTreeSitterDir } from "./on-prem-symbol-index.js";
import { logDebug } from "../logger.js";

/** The local-index backings this module made — they are not Desktop. */
const localIndexBackings = new WeakSet<RepoSemanticCapability>();

/** True when `semantic` is the local code-index backing (no Desktop behind it). */
export function isLocalIndexSemantic(semantic: RepoSemanticCapability | undefined): boolean {
  return semantic != null && localIndexBackings.has(semantic);
}

/** `semantic_search` + `repo_map` from the working tree's code index — the backing without Desktop. */
export function localIndexSemantic(workspaceRoot: string): RepoSemanticCapability {
  const semantic = workspaceSemantic(
    { root: workspaceRoot, caps: buildNodeCapabilityProvider({ workspaceRoot }) },
    { grammar: () => ({ wasmDir: onPremTreeSitterDir() }) },
  );
  localIndexBackings.add(semantic);
  return semantic;
}

/** Desktop's backing when it answers, else the local code index and repo map. */
export async function resolveOnPremSemantic(
  workspaceRoot: string,
  opts?: { adaptive?: boolean },
): Promise<RepoSemanticCapability> {
  setDesktopClientName("on-prem");
  const desktop = await catalogDesktopSemantic(workspaceRoot, opts).catch((err: unknown) => { logDebug(`desktop semantic unavailable, using the local index: ${String(err)}`); return undefined; });
  return desktop ?? localIndexSemantic(workspaceRoot);
}
