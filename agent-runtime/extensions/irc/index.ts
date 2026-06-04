import type { ChannelPlugin, BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { emptyPluginConfigSchema } from "@seanhogg/builderforce-agents/plugin-sdk";
import { ircPlugin } from "./src/channel.js";
import { setIrcRuntime } from "./src/runtime.js";

const plugin = {
  id: "irc",
  name: "IRC",
  description: "IRC channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: BuilderForceAgentsPluginApi) {
    setIrcRuntime(api.runtime);
    api.registerChannel({ plugin: ircPlugin as ChannelPlugin });
  },
};

export default plugin;
