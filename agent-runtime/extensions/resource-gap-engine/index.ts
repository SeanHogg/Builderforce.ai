import type { BuilderForceAgentsPluginApi as SDKApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import type { BuilderForceAgentsPluginApi as LegacyApi } from "../../src/plugins/types.js";
import { createResourceGapTool } from "./src/tool.js";
import type { AnyAgentTool } from "../../src/plugins/types.js";

type PluginApi = SDKApi & LegacyApi;

function register(api: PluginApi) {
  const tool = createResourceGapTool(api as unknown as never);
  // @ts-expect-error - support both SDK shapes
  if (typeof api.registerTool === "function") {
    api.registerTool(tool as unknown as AnyAgentTool, { optional: true });
  }
}

export default register;
export { register };
