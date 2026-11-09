import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { emptyPluginConfigSchema } from "@seanhogg/builderforce-agents/plugin-sdk";
import { bluebubblesPlugin } from "./src/channel.js";
import { handleBlueBubblesWebhookRequest } from "./src/monitor.js";
import { setBlueBubblesRuntime } from "./src/runtime.js";

const plugin = {
  id: "bluebubbles",
  name: "BlueBubbles",
  description: "BlueBubbles channel plugin (macOS app)",
  configSchema: emptyPluginConfigSchema(),
  register(api: BuilderForceAgentsPluginApi) {
    setBlueBubblesRuntime(api.runtime);
    api.registerChannel({ plugin: bluebubblesPlugin });
    // Public webhook: the handler verifies its own per-account token
    // (guid/password via safeEqualSecret in src/monitor.ts).
    api.registerHttpHandler(handleBlueBubblesWebhookRequest, { auth: "public" });
  },
};

export default plugin;
