/**
 * The editor's `repo.semantic` backing for one tool call, resolved the way a catalog is:
 *
 *   - Builderforce Desktop answering ⇒ its capability, WITH the LLMLingua-2 compressor when
 *     its health probe reports one (`catalogDesktopSemantic`) — the C8 compression path
 *     (`run_command` / `web_fetch` outputs, `read_compressed`) was dead here while the
 *     editor built the capability without asking;
 *   - Desktop absent ⇒ `repo_map` served from the workspace's own definition index
 *     (`symbolIndexSemantic`); `semantic_search` is withheld from the catalog meanwhile.
 *
 * The probe is cached for 30 s in node-desktop, so a per-call resolve costs nothing.
 * Pure Node (no `vscode` import).
 */

import { symbolIndexSemantic, type RepoSemanticCapability } from "@builderforce/agent-tools";
import { catalogDesktopSemantic } from "./desktopContext";
import { hostCostLeverOn } from "./hostCostLevers";
import { workspaceSymbolIndex } from "./workspaceSymbols";

export async function resolveLocalSemantic(root: string): Promise<RepoSemanticCapability> {
  const desktop = await catalogDesktopSemantic(root, { adaptive: hostCostLeverOn("c4_adaptive_context") }).catch(() => undefined);
  return desktop ?? symbolIndexSemantic(() => workspaceSymbolIndex(root).filesUnder());
}
