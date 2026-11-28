/**
 * The on-prem `repo.semantic` backing: the ONE resolver (`resolveWorkspaceSemantic`,
 * `@builderforce/workspace-mcp`) fed this host's pieces:
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
import { nodeWatchPort } from "@builderforce/agent-tools/node-watch-port";
import { resolveWorkspaceSemantic, workspaceSemantic } from "@builderforce/workspace-mcp";
import { onPremRootId } from "./knowledge/index/onPremRootId.js";
import { buildNodeCapabilityProvider } from "./node-capability-provider.js";
import { onPremTreeSitterDir } from "./on-prem-symbol-index.js";
import { logDebug } from "../logger.js";

/**
 * `semantic_search` + `repo_map` from the working tree's code index — the backing without Desktop.
 * `options.embedder` overrides the model-backed embedder (a test passes `async () => undefined`: no model load).
 */
export function localIndexSemantic(
  workspaceRoot: string,
  options: Pick<NonNullable<Parameters<typeof workspaceSemantic>[1]>, "embedder"> = {},
): RepoSemanticCapability {
  return workspaceSemantic(
    { root: workspaceRoot, caps: buildNodeCapabilityProvider({ workspaceRoot }) },
    { grammar: () => ({ wasmDir: onPremTreeSitterDir() }), watch: nodeWatchPort(), rootId: (root) => onPremRootId(root), ...options },
  );
}

/** Desktop's backing when it answers, else the local code index and repo map. */
export async function resolveOnPremSemantic(
  workspaceRoot: string,
  opts?: { adaptive?: boolean },
): Promise<RepoSemanticCapability> {
  setDesktopClientName("on-prem");
  return resolveWorkspaceSemantic({
    desktop: () => catalogDesktopSemantic(workspaceRoot, opts),
    local: () => localIndexSemantic(workspaceRoot),
    onDesktopError: (err) => logDebug(`desktop semantic unavailable, using the local index: ${String(err)}`),
  });
}
