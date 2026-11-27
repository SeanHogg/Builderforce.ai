/**
 * The editor's `repo.semantic` backing for one tool call, resolved the way a catalog is:
 *
 *   - Builderforce Desktop answering ⇒ its capability, WITH the LLMLingua-2 compressor when
 *     its health probe reports one (`catalogDesktopSemantic`) — the C8 compression path
 *     (`run_command` / `web_fetch` outputs, `read_compressed`) was dead here while the
 *     editor built the capability without asking;
 *   - Desktop absent ⇒ the workspace's own code index and reference-ranked repo map
 *     (`workspaceSemantic`, the same backing the Workspace MCP serves): `semantic_search`
 *     and `repo_map` both answer locally.
 *
 * The probe is cached for 30 s in node-desktop, so a per-call resolve costs nothing.
 * Pure Node (no `vscode` import).
 */

import { type RepoSemanticCapability } from "@builderforce/agent-tools";
import { workspaceSemantic } from "@builderforce/workspace-mcp";
import { catalogDesktopSemantic } from "../context/desktopContext";
import { hostCostLeverOn } from "../host/hostCostLevers";
import { buildLocalCapabilityProvider } from "./localCapabilities";

export async function resolveLocalSemantic(root: string): Promise<RepoSemanticCapability> {
  const desktop = await catalogDesktopSemantic(root, { adaptive: hostCostLeverOn("c4_adaptive_context") }).catch(() => undefined);
  return desktop ?? workspaceSemantic({ root, caps: buildLocalCapabilityProvider(root) });
}
