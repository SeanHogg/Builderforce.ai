import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { emptyPluginConfigSchema } from "@seanhogg/builderforce-agents/plugin-sdk";
import { createHealthSnapshotsService } from "./src/service.js";

const plugin = {
  id: "health-snapshots",
  name: "Health Snapshots",
  description:
    "Capture, store, and compare historical health snapshots across components, resources, and versions",
  configSchema: emptyPluginConfigSchema(),
  register(api: BuilderForceAgentsPluginApi) {
    api.registerService(createHealthSnapshotsService());
  },
};

export default plugin;