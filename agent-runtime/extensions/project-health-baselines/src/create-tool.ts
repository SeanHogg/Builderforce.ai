/**
 * baseline.create tool stub
 */

import type { BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";

export function createBaselineTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "baseline.create",
    label: "Create",
    description: "Save an AI response as a baseline (PRD #294 tool). AC-1 (token guard) and AC-2 (immutability) are enforced.",
    async execute(_id: string, _params: Record<string, unknown>) {
      // Stub placeholder for future Sprint99 implementation
      // Real behavior:
      //  1) Validate responseText length via validateResponseLength (AC-1)
      //  2) Validate required fields via validateBaselineCreation (AC-1)
      //  3) Check maxBaselinesPerProject (PRD max cap)
      //  4) Determine version string via baselineStore.inferVersion
      //  5) Construct Baseline entity and insert via baselineStore.insertAndReturnKey
      //  6) Append audit entry
      //  7) Apply auditLogPath if configured
      //  8) persistToBackend backend sync (TODO)
      //  9) Return { id, version, status, createdAt, updatedAt, auditTrail, metadata, content, author }
      throw new Error("Not implemented yet: Stub placeholder");
    }
  };
}