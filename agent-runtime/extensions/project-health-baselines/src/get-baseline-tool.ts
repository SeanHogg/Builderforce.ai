/**
 * baseline.get tool stub
 */

import type { BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";

export function getBaselineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.get",
    label: "Get Baseline",
    description: "Retrieve a specific baseline by ID, name, or version; returns full Baseline entity",
    async execute(_id: string, _params: Record<string, unknown>) {
      // Stub: future Sprint99 queries baselineStore.get(id)
      throw new Error("Not implemented yet: Stub placeholder");
    }
  };
}