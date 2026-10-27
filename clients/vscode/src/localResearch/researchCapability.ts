/**
 * The editor's `local.research` backing for one tool call: the registered local model
 * (`researchPort.ts`) over the shared Node half (`@builderforce/agent-tools/node-research`
 * — file fingerprints off the workspace disk and the workspace's persisted answer cache,
 * the same implementation the on-prem runtime uses). Undefined while no port is
 * registered. Pure Node (no `vscode` import).
 */

import type { LocalResearchCapability } from "@builderforce/agent-tools";
import { nodeResearchCapability } from "@builderforce/agent-tools/node-research";
import { localResearchPort } from "./researchPort";

export { workspaceFingerprints } from "@builderforce/agent-tools/node-research";

export function editorResearchCapability(root: string): LocalResearchCapability | undefined {
  const port = localResearchPort();
  return port ? nodeResearchCapability(root, port) : undefined;
}
