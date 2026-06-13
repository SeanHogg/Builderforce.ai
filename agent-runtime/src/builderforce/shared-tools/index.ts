/**
 * On-prem (Node) consumption of the shared cross-runtime tool contract
 * (`@builderforce/agent-tools`): a disk/shell {@link CapabilityProvider} + the
 * surface-agnostic `LocalAgentEngine`, so the SAME tool definitions the cloud engine
 * runs also run on-prem — with no third-party agent framework in the path.
 */

export { buildNodeCapabilityProvider, NODE_SURFACE_CAPS } from "./node-capability-provider.js";
export { LocalAgentEngine, createGatewayComplete } from "./local-agent-engine.js";
export type { LlmComplete, LocalEngineDeps, RawToolCall } from "./local-agent-engine.js";
