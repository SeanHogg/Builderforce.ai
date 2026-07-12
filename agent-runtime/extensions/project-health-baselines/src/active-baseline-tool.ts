/**
 * baseline.active tool stub
 */

import type { BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";

export function getActiveBaselineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.active",
    label: "Get Active Baseline",
    description: "Retrieve the currently active baseline for a project and stream",
    async execute(_id: string, _params: Record<string, unknown>) {
      // Stub: future Sprint99 queries baselineStore.getActive(projectId, streamName)
      throw new Error("Not implemented yet: Stub placeholder");
    }
  };
}