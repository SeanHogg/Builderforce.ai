/**
 * Holds the PluginApi captured at register() time so tool factories and the
 * HTTP handler (registered later, against a different callback surface) can
 * reach logging, config and the embedded-agent runner without a global.
 */
import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";

let api: BuilderForceAgentsPluginApi | null = null;

export function setA2aRuntime(next: BuilderForceAgentsPluginApi): void {
  api = next;
}

export function getA2aRuntime(): BuilderForceAgentsPluginApi {
  if (!api) {
    throw new Error("a2a: plugin runtime not initialised");
  }
  return api;
}
