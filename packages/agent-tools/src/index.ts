/**
 * @builderforce/agent-tools — the runtime-agnostic agent tool contract shared by the
 * cloud (Cloudflare Worker `api`) and on-prem (Node `agent-runtime`) engines.
 *
 * One {@link ToolDefinition} shape, capability-gated by a {@link CapabilityProvider},
 * collected in a {@link ToolRegistry}, driven by an injectable {@link AgentEngine}.
 * Import this package — never duplicate the contract per runtime.
 */

export * from "./capabilities.js";
export * from "./tool.js";
export * from "./registry.js";
export * from "./engine.js";
export * from "./core-tools.js";
export * from "./limbic.js";
