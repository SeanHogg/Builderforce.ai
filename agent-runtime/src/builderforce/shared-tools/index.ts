/**
 * On-prem (Node) consumption of the shared cross-runtime tool contract
 * (`@builderforce/agent-tools`): a disk/shell {@link CapabilityProvider} + the
 * surface-agnostic `LocalAgentEngine`, so the SAME tool definitions the cloud engine
 * runs also run on-prem — with no third-party agent framework in the path.
 */

import { buildCoreToolRegistry, ToolRegistry } from "@builderforce/agent-tools";
import { NODE_CODE_TOOLS } from "./node-code-tools.js";
import { NODE_ORCHESTRATION_TOOLS } from "./node-orchestration-tools.js";
import { buildNodeServiceTools, type NodeServiceToolDeps } from "./node-service-tools.js";

export { buildNodeCapabilityProvider, NODE_SURFACE_CAPS } from "./node-capability-provider.js";
export { LocalAgentEngine, createGatewayComplete } from "./local-agent-engine.js";
export type { LlmComplete, LocalEngineDeps, RawToolCall } from "./local-agent-engine.js";
export { NODE_CODE_TOOLS } from "./node-code-tools.js";
export { NODE_ORCHESTRATION_TOOLS, createOrchestrateToolDef } from "./node-orchestration-tools.js";
export { buildNodeServiceTools } from "./node-service-tools.js";
export type { NodeServiceToolDeps } from "./node-service-tools.js";

/**
 * The full on-prem tool registry: the runtime-agnostic core tools PLUS the Node-only
 * tools — code intelligence (git history, code/dependency analysis, project
 * knowledge, keyword + semantic codebase search), orchestration/session (orchestrate,
 * agent_fleet, workflow_status, save_session_handoff), and — when `deps` supply the
 * backing config — service tools (memory_search/memory_get). The Node engine builds
 * from this so its tool set matches the legacy on-prem agent — capability-gated,
 * pi-free. Pass `deps` to include the config-backed service tools (omitted otherwise,
 * mirroring the legacy factory's `null` returns).
 */
export function buildNodeToolRegistry(deps?: NodeServiceToolDeps): ToolRegistry {
  const registry = buildCoreToolRegistry();
  // The factory always emits its deps-independent tools (agents_list, gateway) and
  // adds config-gated ones (memory_*) only when `deps` supply the backing.
  const serviceTools = buildNodeServiceTools(deps ?? {});
  for (const tool of [...NODE_CODE_TOOLS, ...NODE_ORCHESTRATION_TOOLS, ...serviceTools]) registry.register(tool);
  return registry;
}
