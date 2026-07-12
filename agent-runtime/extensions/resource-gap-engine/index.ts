import type { AnyAgentTool, BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";

export function register(api: BuilderForceAgentsPluginApi): void {
  api.registerTool(createResourceGapTool(api), { optional: true });
}