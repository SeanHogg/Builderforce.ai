import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { emptyPluginConfigSchema } from "@seanhogg/builderforce-agents/plugin-sdk";
import { createDataCompletenessTool } from "./src/tool.js";

const dataCompletenessPlugin = {
  id: "data-completeness",
  name: "Data Completeness",
  description: "Score record or dataset completeness (0-100%) with configurable field weights and thresholds",
  version: "2026.3.21",
  kind: "utility",
  configSchema: emptyPluginConfigSchema(),
  register(api: BuilderForceAgentsPluginApi) {
    api.registerTool(
      createDataCompletenessTool,
      { names: ["score_data_completeness"] }
    );
  },
};

export default dataCompletenessPlugin;