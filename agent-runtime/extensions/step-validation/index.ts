import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { emptyPluginConfigSchema } from "@seanhogg/builderforce-agents/plugin-sdk";
import { stepValidationPlugin } from "./src/plugin.js";

const plugin = {
  id: "step-validation",
  name: "Step Validation",
  description: "Step-level integration validation framework: pre/post input/output contracts, structured diagnostics, failure modes, CLI tooling, LLM tool-call instrumentation",
  configSchema: emptyPluginConfigSchema(),
  register(api: BuilderForceAgentsPluginApi) {
    // Delegates to stepValidationPlugin.start/stop, which registers the service.
    // The service itself (BuilderForceAgentsPluginService) is returned in plugin.ts.
    stepValidationPlugin.start({ api });
  },
};

export default plugin;