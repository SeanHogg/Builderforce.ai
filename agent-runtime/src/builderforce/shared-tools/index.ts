/**
 * On-prem (Node) consumption of the shared cross-runtime tool contract
 * (`@builderforce/agent-tools`): a disk/shell {@link CapabilityProvider} + the
 * surface-agnostic `LocalAgentEngine`, so the SAME tool definitions the cloud engine
 * runs also run on-prem — with no third-party agent framework in the path.
 */

import { buildCoreToolRegistry, ToolRegistry } from "@builderforce/agent-tools";
import { NODE_CODE_TOOLS } from "./node-code-tools.js";

export { buildNodeCapabilityProvider, NODE_SURFACE_CAPS } from "./node-capability-provider.js";
export { LocalAgentEngine, createGatewayComplete } from "./local-agent-engine.js";
export type { LlmComplete, LocalEngineDeps, RawToolCall } from "./local-agent-engine.js";
export { NODE_CODE_TOOLS } from "./node-code-tools.js";

/**
 * The full on-prem tool registry: the runtime-agnostic core tools PLUS the
 * Node-native code-intelligence tools (git history, code analysis, project
 * knowledge, keyword + semantic codebase search). The Node engine builds from this
 * so its tool set matches the legacy on-prem agent — capability-gated, pi-free.
 */
export function buildNodeToolRegistry(): ToolRegistry {
  const registry = buildCoreToolRegistry();
  for (const tool of NODE_CODE_TOOLS) registry.register(tool);
  return registry;
}
