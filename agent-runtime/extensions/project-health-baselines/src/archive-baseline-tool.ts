/**
 * baseline.archive tool stub
 */

import type { BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";

export function archiveBaselineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.archive",
    label: "Archive Baseline",
    description: "Mark a baseline as archived (soft delete); does not hard delete data",
    async execute(_id: string, _params: Record<string, unknown>) {
      // Stub: future Sprint99 calls baselineStore.updateStatus(baseline.id, "archived")
      throw new Error("Not implemented yet: Stub placeholder");
    }
  };
}