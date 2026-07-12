import type { AnyAgentTool, BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";

export * from "./src/types.js";

export const RESOURCE_GAP_ENGINE_KEY = Symbol("resource-gap-engine");
export type ResourceGapEngineKey = typeof RESOURCE_GAP_ENGINE_KEY;

export function createResourceGapEngineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "resource-gap-engine-tool",
    description: "Compute resource gap analysis with hiring, deployment, and upskill recommendations.",
    parameters: {
      type: "object",
      properties: { /* No structured parameters yet — reserved for future CLI/API surface. */ }
    },
    handler: async (_input) => {
      return {
        _meta: {
          __builderforce_plugin__: "resource-gap-engine",
          version: "0.0.0-alpha"
        },
        message: "BuilderForce Resource Gap Engine is available as a literal key (RESOURCE_GAP_ENGINE_KEY). Structured tool parameters are reserved for follow-up tasks (#uf20-#uf23)."
      };
    }
  } as AnyAgentTool;
}

export default function register(api: BuilderForceAgentsPluginApi) {
  const tool = createResourceGapEngineTool(api);
  api.registerTool(tool, { optional: true });
}