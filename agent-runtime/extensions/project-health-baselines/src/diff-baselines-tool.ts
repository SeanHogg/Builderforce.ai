/**
 * baseline.diff tool stub
 */

import type { BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";

export function diffBetweenBaselinesTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.diff",
    label: "Diff Baselines",
    description: "Compute paragraph-level side-by-side diff between two baselines; generates AI-assisted health delta summary (AC-4, AC-8)",
    async execute(_id: string, _params: Record<string, unknown>) {
      // Stub: future Sprint99 implements Levenshtein diff of paragraphs, AI delta summary per PRD AC-4/AC-8
      throw new Error("Not implemented yet: Stub placeholder");
    }
  };
}