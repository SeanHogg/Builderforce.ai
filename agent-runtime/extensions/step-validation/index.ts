import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { emptyPluginConfigSchema } from "@seanhogg/builderforce-agents/plugin-sdk";
import { createStepValidationService } from "./src/plugin.js";

const plugin = {
  id: "step-validation",
  name: "Step Validation",
  description: "Step-level integration validation framework",
  version: "1.0.0",
  configSchema: emptyPluginConfigSchema(),
  register(api: BuilderForceAgentsPluginApi) {
    api.registerService(createStepValidationService(api));
  },
};

export default plugin;