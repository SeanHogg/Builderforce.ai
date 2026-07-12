/**
 * baseline.list tool stub
 */

import type { BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";

export function listBaselinesTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.list",
    label: "List Baselines",
    description: "List baselines for a project with optional filters (status, tags, name, author, date, pagination)",
    async execute(_id: string, _params: Record<string, unknown>) {
      // Stub: future Sprint99 implements filtering by BaselineListFilters on project
      throw new Error("Not implemented yet: Stub placeholder");
    }
  };
}