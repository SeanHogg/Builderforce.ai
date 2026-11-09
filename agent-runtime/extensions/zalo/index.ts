import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { emptyPluginConfigSchema } from "@seanhogg/builderforce-agents/plugin-sdk";
import { zaloDock, zaloPlugin } from "./src/channel.js";
import { handleZaloWebhookRequest } from "./src/monitor.js";
import { setZaloRuntime } from "./src/runtime.js";

const plugin = {
  id: "zalo",
  name: "Zalo",
  description: "Zalo channel plugin (Bot API)",
  configSchema: emptyPluginConfigSchema(),
  register(api: BuilderForceAgentsPluginApi) {
    setZaloRuntime(api.runtime);
    api.registerChannel({ plugin: zaloPlugin, dock: zaloDock });
    // Public webhook: the handler verifies its own per-account token
    // (token check in src/monitor.ts).
    api.registerHttpHandler(handleZaloWebhookRequest, { auth: "public" });
  },
};

export default plugin;
