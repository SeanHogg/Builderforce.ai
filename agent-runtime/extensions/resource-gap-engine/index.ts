import type { AnyAgentTool, BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";
import { createResourceGapTool } from "./src/tool.js";

export default function register(api: BuilderForceAgentsPluginApi) {
  api.registerTool(createResourceGapTool(api) as unknown as AnyAgentTool, { optional: true });
}
