import type { AnyAgentTool, BuilderForceAgentsPluginApi } from "../../src/plugins/types.js";
import { createCodeGapsTool } from "./src/code-gaps-tool.js";

export default function register(api: BuilderForceAgentsPluginApi) {
  api.registerTool(createCodeGapsTool(api) as unknown as AnyAgentTool, { optional: true });
}