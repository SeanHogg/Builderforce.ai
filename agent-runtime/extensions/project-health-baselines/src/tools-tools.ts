/**
 * Implementation backlog: bc-v2-tool.ts stub
 * Scope: BC-V2 ResponseStorage
 */

import type { BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";

export function storeResponseTool(api: BuilderForceAgentsPluginApi) {
  return {
    name: "bc-v2.store-response",
    label: "Store AI Response (BC-V2)",
    description:
      "Persist an AI response under ResponseStorage with versioning; ensures monotonically increasing version per project (recommended to gate on incremental changes to prevent accidental drift in AC-1).",
    async execute(_id: string, _params: Record<string, unknown>) {
      // Stub: BC-V2 ResponseStorage implementation will call project/responseStore.saveResponse
      throw new Error("Not implemented yet: BC-V2 ResponseStorage stub");
    }
  };
}