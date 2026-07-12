/**
 * baseline.promote tool stub
 */

import type { BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";

export function promoteBaselineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.promote",
    label: "Promote Baseline",
    description: "Promote a baseline to active status within its stream; auto-archives previous active baseline (only one active per stream). AC-5 enforced.",
    async execute(_id: string, _params: Record<string, unknown>) {
      // Stub: future Sprint99 ensures only one active per stream, calls baselineStore.updateStatus
      throw new Error("Not implemented yet: Stub placeholder");
    }
  };
}