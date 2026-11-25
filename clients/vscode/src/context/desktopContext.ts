/**
 * Builderforce Desktop client — re-exported from the shared node-only
 * `@builderforce/agent-tools/node-desktop` subpath so the editor and on-prem
 * runtime share one probe. This file keeps the original import path so VS Code
 * consumers (`brainToolCatalog`, `extension`, `gateway`, `grounding`,
 * `localCapabilities`, `memoryStaleness`) do not break.
 */
import { setDesktopClientName } from "@builderforce/agent-tools/node-desktop";

setDesktopClientName("vscode");

export {
  type DesktopDiscovery,
  type MissingReference,
  type DesktopModelsEndpoint,
  setDesktopFetchForTests,
  setDesktopClientName,
  catalogDesktopSemantic,
  discoveryFilePath,
  forgetDesktopProbe,
  readDesktopModelsEndpoint,
  liveDesktop,
  desktopSemanticCapability,
  desktopBackedTools,
  registerWorkspace,
  checkReferences,
  desktopRepoMapSection,
  desktopCompressProse,
} from "@builderforce/agent-tools/node-desktop";
