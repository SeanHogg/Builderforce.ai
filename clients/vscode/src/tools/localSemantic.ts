/**
 * The editor's `repo.semantic` backing for one tool call: the ONE resolver
 * (`resolveWorkspaceSemantic`, `@builderforce/workspace-mcp`) fed this host's pieces:
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
 * The local index rides the editor's ONE change feed (`vscodeWatchPort`, the one
 * FileSystemWatcher) and the editor's knowledge root id, exactly as the Workspace MCP does, so
 * both share one watcher and one index file per folder.
 */

import { type RepoSemanticCapability } from "@builderforce/agent-tools";
import { resolveWorkspaceSemantic, workspaceSemantic } from "@builderforce/workspace-mcp";
import { catalogDesktopSemantic } from "../context/desktopContext";
import { logLine } from "../diagnostics/errorReporter";
import { hostCostLeverOn } from "../host/hostCostLevers";
import { knowledgeRootId } from "../knowledge/knowledgeRoots";
import { messageOf } from "../shared/messageOf";
import { symbolGrammarOptions } from "../workspace/workspaceSymbols";
import { vscodeWatchPort } from "../workspace/workspaceSymbolWatch";
import { buildLocalCapabilityProvider } from "./localCapabilities";

export function resolveLocalSemantic(root: string): Promise<RepoSemanticCapability> {
  return resolveWorkspaceSemantic({
    desktop: () => catalogDesktopSemantic(root, { adaptive: hostCostLeverOn("c4_adaptive_context") }),
    local: () => workspaceSemantic({ root, caps: buildLocalCapabilityProvider(root) }, { grammar: symbolGrammarOptions, watch: vscodeWatchPort(), rootId: knowledgeRootId }),
    onDesktopError: (err) => logLine(`desktop semantic unavailable, using the local index: ${messageOf(err)}`),
  });
}
